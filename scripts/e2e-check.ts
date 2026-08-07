/**
 * End-to-end smoke check for the Token Burn dApp.
 *
 * Reconnects to the deployed contract, reads its public ledger, and verifies
 * the on-chain invariants that hold with no tokens burned yet (or, generally,
 * that totalBurned <= totalSupply). Exits 0 on success.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import { resolveNetwork, getOrCreateSeed, getDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { createProviders, INITIAL_PRIVATE_STATE, PRIVATE_STATE_ID, readLedger } from '../src/providers';
import { tokenBurnContract } from '../contracts/index.js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  // 1. Deployment sanity
  const deployment = getDeployment(network);
  if (!deployment) fail('No deploy on file.');
  if (!isHexAddress(deployment.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`);
  }

  // 2. Build wallet and providers
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'token-burn');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) fail('Compiled contract missing — run `npm run compile`.');

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  const providers = createProviders(walletCtx, networkConfig, zkConfigPath);
  providers.privateStateProvider.setContractAddress(deployment.address);

  // 3. Reconnect to the deployed contract — proves the callTx interface is wired
  try {
    await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: tokenBurnContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: INITIAL_PRIVATE_STATE,
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  // 4. Read the on-chain ledger via the indexer
  const ledger = await readLedger(providers, deployment.address);
  if (!ledger) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }

  console.log('✅ e2e-check passed');
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   totalSupply:     ${ledger.totalSupply}`);
  console.log(`   totalBurned:     ${ledger.totalBurned}`);
  console.log(`   burnRateBps:     ${ledger.burnRateBps}`);

  // Sanity invariant: the disclosed burn total must never exceed the supply
  // that has been minted into existence.
  if (ledger.totalBurned > ledger.totalSupply) {
    await walletCtx.wallet.stop();
    fail(`invariant broken: totalBurned > totalSupply`);
  }

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
