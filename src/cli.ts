/**
 * Interactive CLI for the Token Burn dApp.
 *
 * The CLI runs as the *operator*: one wallet holds the authoritative balances
 * map in its private state. Accounts are referenced by nickname and their
 * secrets are derived deterministically from the wallet seed (see accounts.ts).
 * Every transfer / burn on-chain call updates the private balances map locally
 * and discloses only the aggregate burn through the public ledger.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import { resolveNetwork, getOrCreateSeed, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { createProviders, INITIAL_PRIVATE_STATE, PRIVATE_STATE_ID, readLedger } from './providers';
import { tokenAccount, OWNER_ACCOUNT_INDEX, type TokenAccount } from './accounts';
import { tokenBurnContract } from '../contracts/index.js';
import { bytesToHex } from '../contracts/witnesses.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const ACCOUNTS_FILE = '.token-burn-accounts.json';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'token-burn');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

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

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Token Burn — Interactive CLI                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`);
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network:  ${network}\n`);
  const contractAddress = deployment.address;

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    console.log('  Syncing with network...');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');
    await persistWalletState(network, walletCtx);

    console.log('  Connecting to contract...');
    const providers = createProviders(walletCtx, networkConfig, zkConfigPath);
    providers.privateStateProvider.setContractAddress(contractAddress);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: tokenBurnContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: INITIAL_PRIVATE_STATE,
    });

    console.log('  ✅ Connected!\n');

    async function currentPrivateBalances(): Promise<Map<string, bigint>> {
      const ps = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
      if (!ps) return new Map();
      return (ps as { balances: Map<string, bigint> }).balances ?? new Map();
    }

    async function accountFor(nickname: string): Promise<TokenAccount> {
      const registry = loadAccounts();
      const entry = registry[nickname];
      if (!entry) throw new Error(`Unknown account "${nickname}". Create it with option 4.`);
      return tokenAccount(SEED, entry.index);
    }

    function ownerAccount(): TokenAccount {
      return tokenAccount(SEED, OWNER_ACCOUNT_INDEX);
    }

    async function printDashboard() {
      const ledger = await readLedger(providers, contractAddress);
      const balances = await currentPrivateBalances();
      const registry = loadAccounts();

      console.log('─── Token Dashboard ──────────────────────────────────────────');
      if (ledger) {
        const burnedPct = ledger.totalSupply + ledger.totalBurned > 0n
          ? ((ledger.totalBurned * 10000n) / (ledger.totalSupply + ledger.totalBurned))
          : 0n;
        console.log(`  Total supply:  ${ledger.totalSupply.toLocaleString()} TBURN`);
        console.log(`  Total burned:  ${ledger.totalBurned.toLocaleString()} TBURN (${Number(burnedPct) / 100}% of initial)`);
        console.log(`  Burn rate:     ${Number(ledger.burnRateBps) / 100}% per transfer`);
      } else {
        console.log('  ⚠ No indexed ledger state yet.');
      }
      console.log('');
      for (const [nickname, entry] of Object.entries(registry)) {
        const acc = tokenAccount(SEED, entry.index);
        const bal = balances.get(acc.accountKeyHex) ?? 0n;
        console.log(`  ${nickname.padEnd(16)} ${bal.toLocaleString().padStart(14)} TBURN   (${acc.accountKeyHex.slice(0, 12)}…)`);
      }
      console.log('');
    }

    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Token dashboard (supply, burned, balances)');
      console.log('  2. Transfer tokens (auto-burns the burn rate)');
      console.log('  3. Burn tokens voluntarily (100%)');
      console.log('  4. Create account');
      console.log('  5. Fund account from owner');
      console.log('  6. Show account balance');
      console.log('  7. Check wallet tNight balance');
      console.log('  8. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          await printDashboard();
          break;
        }

        case '2': {
          const from = await rl.question('  From account (nickname): ');
          const to = await rl.question('  To account (nickname): ');
          const amountStr = await rl.question('  Amount (TBURN): ');
          const amount = BigInt(amountStr.trim());
          if (amount <= 0n) throw new Error('Amount must be positive');
          const fromAcc = await accountFor(from.trim());
          const toAcc = await accountFor(to.trim());
          const ledger = await readLedger(providers, contractAddress);
          const burn = ledger ? (amount * ledger.burnRateBps) / 10000n : 0n;
          console.log(`\n  Transferring ${amount.toLocaleString()} TBURN ${from} → ${to}`);
          console.log(`  Auto-burn: ${burn.toLocaleString()} TBURN (${Number(ledger?.burnRateBps ?? 0) / 100}%)`);
          console.log('  Submitting transaction (this may take 30-60 seconds)...');
          const tx = await deployed.callTx.transfer(fromAcc.sk, toAcc.accountKey, amount);
          const after = await readLedger(providers, contractAddress);
          console.log(`\n  ✅ Transfer confirmed`);
          console.log(`  New total supply: ${after?.totalSupply.toLocaleString() ?? '?'} TBURN`);
          console.log(`  New total burned: ${after?.totalBurned.toLocaleString() ?? '?'} TBURN`);
          console.log(`  Block height: ${tx.public.blockHeight}\n`);
          break;
        }

        case '3': {
          const nickname = await rl.question('  Account (nickname): ');
          const amountStr = await rl.question('  Amount (TBURN): ');
          const amount = BigInt(amountStr.trim());
          if (amount <= 0n) throw new Error('Amount must be positive');
          const acc = await accountFor(nickname.trim());
          console.log(`\n  Burning ${amount.toLocaleString()} TBURN from ${nickname.trim()}`);
          console.log('  Submitting transaction (this may take 30-60 seconds)...');
          const tx = await deployed.callTx.burn(acc.sk, amount);
          const after = await readLedger(providers, contractAddress);
          console.log(`\n  ✅ Burn confirmed`);
          console.log(`  New total supply: ${after?.totalSupply.toLocaleString() ?? '?'} TBURN`);
          console.log(`  New total burned: ${after?.totalBurned.toLocaleString() ?? '?'} TBURN`);
          console.log(`  Block height: ${tx.public.blockHeight}\n`);
          break;
        }

        case '4': {
          const nickname = (await rl.question('  Nickname: ')).trim();
          if (!/^[a-zA-Z0-9_-]+$/.test(nickname)) throw new Error('Nickname must be alphanumeric (_, - allowed)');
          const registry = loadAccounts();
          if (registry[nickname]) throw new Error(`Account "${nickname}" already exists`);
          const indices = Object.values(registry).map((e) => e.index);
          const nextIndex = indices.length === 0 ? 1 : Math.max(...indices) + 1;
          registry[nickname] = { index: nextIndex };
          saveAccounts(registry);
          const acc = tokenAccount(SEED, nextIndex);
          console.log(`\n  ✅ Account "${nickname}" created (index ${nextIndex})`);
          console.log(`  Account key: ${acc.accountKeyHex}\n`);
          console.log('  Fund it from the owner with option 5 to give it a balance.\n');
          break;
        }

        case '5': {
          const nickname = (await rl.question('  Account to fund (nickname): ')).trim();
          const amountStr = await rl.question('  Amount (TBURN): ');
          const amount = BigInt(amountStr.trim());
          if (amount <= 0n) throw new Error('Amount must be positive');
          const owner = ownerAccount();
          const target = await accountFor(nickname);
          const ledger = await readLedger(providers, contractAddress);
          const burn = ledger ? (amount * ledger.burnRateBps) / 10000n : 0n;
          console.log(`\n  Funding ${nickname} with ${amount.toLocaleString()} TBURN from owner`);
          console.log(`  Auto-burn: ${burn.toLocaleString()} TBURN`);
          console.log('  Submitting transaction (this may take 30-60 seconds)...');
          await deployed.callTx.transfer(owner.sk, target.accountKey, amount);
          console.log('\n  ✅ Funded (transfer + auto-burn confirmed)\n');
          break;
        }

        case '6': {
          const nickname = (await rl.question('  Account (nickname): ')).trim();
          const acc = await accountFor(nickname);
          const balances = await currentPrivateBalances();
          const bal = balances.get(acc.accountKeyHex) ?? 0n;
          console.log(`\n  ${nickname} balance: ${bal.toLocaleString()} TBURN`);
          console.log(`  Account key: ${acc.accountKeyHex}\n`);
          break;
        }

        case '7': {
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const tNight = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dust = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${tNight.toLocaleString()}`);
          console.log(`  DUST:   ${dust.toLocaleString()}\n`);
          break;
        }

        case '8':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
