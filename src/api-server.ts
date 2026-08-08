/**
 * Node API server for the Token Burn web frontend.
 *
 * Runs the *operator* wallet in-process (the same wallet the CLI uses) and
 * exposes REST endpoints that the Vite frontend proxies to. Token actions
 * (transfer / burn / fund) generate ZK proofs and can take 30-60 seconds, so
 * they run as serialized background jobs; the frontend polls /api/jobs/:id.
 *
 * Start with:  npm run api           (listens on http://127.0.0.1:4173)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import express from 'express';
import cors from 'cors';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import { resolveNetwork, getOrCreateSeed, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { createProviders, PRIVATE_STATE_ID, readLedger, type TokenBurnLedger } from './providers';
import { tokenAccount, OWNER_ACCOUNT_INDEX, type TokenAccount } from './accounts';
import { tokenBurnContract } from '../contracts/index.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const API_PORT = Number(process.env.API_PORT?.trim() || 4173);
const ACCOUNTS_FILE = '.token-burn-accounts.json';

type AccountRegistry = Record<string, { index: number }>;

function loadAccounts(): AccountRegistry {
  if (!fs.existsSync(ACCOUNTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')) as AccountRegistry;
  } catch {
    return {};
  }
}

function saveAccounts(registry: AccountRegistry): void {
  fs.writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(registry, null, 2)}\n`);
}

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'token-burn');

// ─── Boot state ────────────────────────────────────────────────────────────
let ready = false;
let bootError: string | null = null;
let booting = false;

let walletCtx: WalletContext | null = null;
let providers: ReturnType<typeof createProviders> | null = null;
let deployed: any = null;
let contractAddress: string | null = null;

async function boot(): Promise<void> {
  if (ready || booting) return;
  booting = true;
  bootError = null;

  const deployment = getDeployment(network);
  if (!deployment) {
    bootError = `No deploy on file for network "${network}". Run \`npm run setup\` first.`;
    booting = false;
    return;
  }

  try {
    walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    await walletCtx.wallet.waitForSyncedState();
    await persistWalletState(network, walletCtx);

    providers = createProviders(walletCtx, networkConfig, zkConfigPath);
    providers.privateStateProvider.setContractAddress(deployment.address);

    deployed = await findDeployedContract(providers, {
      compiledContract: tokenBurnContract,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
    });

    contractAddress = deployment.address;
    ready = true;
    console.log(`✅ API server wallet ready — contract ${contractAddress}`);
  } catch (err) {
    bootError = err instanceof Error ? err.message : String(err);
    if (walletCtx) {
      try {
        await walletCtx.wallet.stop();
      } catch {
        /* ignore */
      }
      walletCtx = null;
    }
  } finally {
    booting = false;
  }
}

function requireReady(res: express.Response): boolean {
  if (ready) return true;
  res.status(503).json({
    ok: false,
    ready: false,
    network,
    bootError: bootError ?? 'Wallet still booting...',
  });
  return false;
}

// ─── Private state / accounts helpers ──────────────────────────────────────
async function currentPrivateBalances(): Promise<Map<string, bigint>> {
  if (!providers) throw new Error('Not ready');
  const ps = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  if (!ps) return new Map();
  return (ps as { balances: Map<string, bigint> }).balances ?? new Map();
}

function accountFor(nickname: string): TokenAccount {
  const registry = loadAccounts();
  const entry = registry[nickname];
  if (!entry) throw new Error(`Unknown account "${nickname}". Create it first.`);
  return tokenAccount(SEED, entry.index);
}

function ownerAccount(): TokenAccount {
  return tokenAccount(SEED, OWNER_ACCOUNT_INDEX);
}

function toAmount(value: unknown): bigint {
  const raw = typeof value === 'string' ? value.trim() : value;
  const amount = BigInt(raw as string | number);
  if (amount <= 0n) throw new Error('Amount must be positive');
  return amount;
}

// ─── Serialized background jobs ────────────────────────────────────────────
interface Job {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, Job>();
let queueTail: Promise<unknown> = Promise.resolve();

function enqueue(kind: string, run: () => Promise<unknown>): string {
  const job: Job = { id: randomUUID(), kind, status: 'queued', startedAt: new Date().toISOString() };
  jobs.set(job.id, job);
  queueTail = queueTail
    .then(async () => {
      job.status = 'running';
      try {
        const result = await run();
        job.status = 'done';
        job.result = result;
      } catch (err) {
        job.status = 'error';
        job.error = err instanceof Error ? err.message : String(err);
      } finally {
        job.finishedAt = new Date().toISOString();
        await persistWalletState(network, walletCtx as WalletContext);
      }
    })
    .catch(() => {
      /* queue itself never rejects */
    });
  return job.id;
}

function serializeLedger(ledger: TokenBurnLedger) {
  const initialSupply = ledger.totalSupply + ledger.totalBurned;
  const burnedPct = initialSupply > 0n ? (ledger.totalBurned * 10000n) / initialSupply : 0n;
  return {
    totalSupply: ledger.totalSupply.toString(),
    totalBurned: ledger.totalBurned.toString(),
    burnRateBps: ledger.burnRateBps.toString(),
    initialSupply: initialSupply.toString(),
    burnedPercent: Number(burnedPct) / 100,
    burnRatePercent: Number(ledger.burnRateBps) / 100,
  };
}

// ─── HTTP app ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ready, network, contractAddress, bootError });
});

app.get('/api/ledger', async (_req, res) => {
  if (!requireReady(res)) return;
  try {
    const ledger = await readLedger(providers as never, contractAddress as string);
    res.json({ ok: true, ledger: ledger ? serializeLedger(ledger) : null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/accounts', async (_req, res) => {
  if (!requireReady(res)) return;
  try {
    const balances = await currentPrivateBalances();
    const registry = loadAccounts();

    const owner = ownerAccount();
    const list = [
      {
        nickname: 'owner',
        index: OWNER_ACCOUNT_INDEX,
        accountKeyHex: owner.accountKeyHex,
        balance: (balances.get(owner.accountKeyHex) ?? 0n).toString(),
        isOwner: true,
      },
    ];
    for (const [nickname, entry] of Object.entries(registry)) {
      const acc = tokenAccount(SEED, entry.index);
      list.push({
        nickname,
        index: entry.index,
        accountKeyHex: acc.accountKeyHex,
        balance: (balances.get(acc.accountKeyHex) ?? 0n).toString(),
        isOwner: false,
      });
    }
    res.json({ ok: true, accounts: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/accounts', (req, res) => {
  if (!requireReady(res)) return;
  try {
    const nickname = String(req.body?.nickname ?? '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(nickname)) {
      res.status(400).json({ ok: false, error: 'Nickname must be alphanumeric (_, - allowed)' });
      return;
    }
    const registry = loadAccounts();
    if (registry[nickname]) {
      res.status(409).json({ ok: false, error: `Account "${nickname}" already exists` });
      return;
    }
    const indices = Object.values(registry).map((e) => e.index);
    const nextIndex = indices.length === 0 ? 1 : Math.max(...indices) + 1;
    registry[nickname] = { index: nextIndex };
    saveAccounts(registry);
    const acc = tokenAccount(SEED, nextIndex);
    res.json({ ok: true, account: { nickname, index: nextIndex, accountKeyHex: acc.accountKeyHex, balance: '0' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/accounts/:nickname', async (req, res) => {
  if (!requireReady(res)) return;
  try {
    const nickname = req.params.nickname;
    const registry = loadAccounts();
    const isOwner = nickname === 'owner';
    const entry = registry[nickname];
    if (!isOwner && !entry) {
      res.status(404).json({ ok: false, error: `Unknown account "${nickname}"` });
      return;
    }
    const acc = isOwner ? ownerAccount() : tokenAccount(SEED, entry.index);
    const balances = await currentPrivateBalances();
    res.json({
      ok: true,
      account: { nickname, index: acc.index, accountKeyHex: acc.accountKeyHex, balance: (balances.get(acc.accountKeyHex) ?? 0n).toString() },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/transfer', (req, res) => {
  if (!requireReady(res)) return;
  try {
    const from = String(req.body?.from ?? '').trim();
    const to = String(req.body?.to ?? '').trim();
    const amount = toAmount(req.body?.amount);

    const fromAcc = from === 'owner' ? ownerAccount() : accountFor(from);
    const toAcc = to === 'owner' ? ownerAccount() : accountFor(to);

    const jobId = enqueue('transfer', async () => {
      const ledger = await readLedger(providers as never, contractAddress as string);
      const burn = ledger ? (amount * ledger.burnRateBps) / 10000n : 0n;
      const tx = await deployed.callTx.transfer(fromAcc.sk, toAcc.accountKey, amount);
      const after = await readLedger(providers as never, contractAddress as string);
      return {
        from,
        to,
        amount: amount.toString(),
        burn: burn.toString(),
        blockHeight: tx.public.blockHeight,
        ledger: after ? serializeLedger(after) : null,
      };
    });
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/burn', (req, res) => {
  if (!requireReady(res)) return;
  try {
    const account = String(req.body?.account ?? '').trim();
    const amount = toAmount(req.body?.amount);
    const acc = account === 'owner' ? ownerAccount() : accountFor(account);

    const jobId = enqueue('burn', async () => {
      const tx = await deployed.callTx.burn(acc.sk, amount);
      const after = await readLedger(providers as never, contractAddress as string);
      return {
        account,
        amount: amount.toString(),
        blockHeight: tx.public.blockHeight,
        ledger: after ? serializeLedger(after) : null,
      };
    });
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/accounts/:nickname/fund', (req, res) => {
  if (!requireReady(res)) return;
  try {
    const nickname = req.params.nickname;
    const amount = toAmount(req.body?.amount);
    const target = accountFor(nickname);

    const jobId = enqueue('fund', async () => {
      const owner = ownerAccount();
      const ledger = await readLedger(providers as never, contractAddress as string);
      const burn = ledger ? (amount * ledger.burnRateBps) / 10000n : 0n;
      const tx = await deployed.callTx.transfer(owner.sk, target.accountKey, amount);
      const after = await readLedger(providers as never, contractAddress as string);
      return {
        account: nickname,
        amount: amount.toString(),
        burn: burn.toString(),
        blockHeight: tx.public.blockHeight,
        ledger: after ? serializeLedger(after) : null,
      };
    });
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/wallet', async (_req, res) => {
  if (!requireReady(res)) return;
  try {
    const state = await walletCtx!.wallet.waitForSyncedState();
    const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    const dust = state.dust.balance(new Date());
    res.json({
      ok: true,
      wallet: {
        address: walletCtx!.unshieldedKeystore.getBech32Address().toString(),
        tNight: tNight.toString(),
        dust: dust.toString(),
        synced: state.isSynced,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Unknown job' });
    return;
  }
  res.json({ ok: true, job });
});

app.get('/api/jobs', (_req, res) => {
  res.json({ ok: true, jobs: [...jobs.values()].slice(-20) });
});

// ─── Startup ───────────────────────────────────────────────────────────────
app.listen(API_PORT, () => {
  console.log(`Token Burn API listening on http://127.0.0.1:${API_PORT}`);
  console.log(`Network: ${network}${networkConfig.networkId === 'undeployed' ? ' (local devnet)' : ''}`);
  void boot();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down...`);
  if (walletCtx) {
    try {
      await persistWalletState(network, walletCtx);
      await walletCtx.wallet.stop();
    } catch (err) {
      console.error('Shutdown error:', err);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
