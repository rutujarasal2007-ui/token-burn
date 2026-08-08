/**
 * Integration tests for the Token Burn contract against the local devnet.
 *
 * Prerequisite: `docker compose up -d --wait` with the node, indexer and
 * proof-server containers healthy (see compose.yml). Run with:
 *
 *   npm run test:integration
 */
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDefaultTestLogger, FluentWalletBuilder, inMemoryPrivateStateProvider, MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/ledger';

import { tokenBurnContract, zkConfigPath } from '../../contracts/index.js';
import { ledger } from '../../contracts/managed/token-burn/contract/index.js';
import { GENESIS_SEED } from '../../src/network.js';
import { OWNER_ACCOUNT_INDEX, tokenAccount } from '../../src/accounts.js';
import { INITIAL_PRIVATE_STATE, PRIVATE_STATE_ID, type TokenBurnCircuitId, type TokenBurnLedger, type TokenBurnProviders } from '../../src/providers.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const RECIPIENT_SEED = '0000000000000000000000000000000000000000000000000000000000000002';

const devnet = {
  walletNetworkId: NetworkId.NetworkId.Undeployed,
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'ws://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  faucet: undefined,
};

setNetworkId(devnet.networkId);

const INITIAL_SUPPLY = 10_000_000n;
const BURN_RATE_BPS = 100n; // 1%
const TRANSFER_AMOUNT = 1_000_000n;
const TRANSFER_BURN = (TRANSFER_AMOUNT * BURN_RATE_BPS) / 10_000n; // 10,000
const VOLUNTARY_BURN = 1_000_000n;
const FEE_OVERHEAD = 1_000_000n; // positive DUST fee; a zero fee is rejected as NotNormalized (117)

const logger = createDefaultTestLogger();

describe('token-burn contract (local devnet)', () => {
  let providers: TokenBurnProviders;
  let deployed: Awaited<ReturnType<typeof deployContract>>;
  let contractAddress: string;

  const owner = tokenAccount(GENESIS_SEED, OWNER_ACCOUNT_INDEX);
  const recipient = tokenAccount(RECIPIENT_SEED, 0);

  async function readLedger(): Promise<TokenBurnLedger> {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state, 'contract state should be indexed').not.toBeNull();
    const l = ledger(state!.data);
    return {
      totalSupply: l.totalSupply,
      totalBurned: l.totalBurned,
      burnRateBps: l.burnRateBps,
    };
  }

  async function readBalances(): Promise<Map<string, bigint>> {
    const ps = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
    return ps?.balances ?? new Map<string, bigint>();
  }

  it('deploys the contract and initializes the ledger + owner balance', async () => {
    // Testkit's default wallet uses additionalFeeOverhead: 0n, so on an idle
    // local devnet (per-block fee rate ~0) it builds a zero-fee transaction
    // with empty DustActions, which the node rejects as NotNormalized (117).
    // Inject a small positive fee so the wallet always pays a DUST fee.
    const { wallet: facade, seeds, keystore } = await FluentWalletBuilder.forEnvironment(devnet)
      .withSeed(GENESIS_SEED)
      .withDustOptions({
        ledgerParams: LedgerParameters.initialParameters(),
        additionalFeeOverhead: FEE_OVERHEAD,
        feeBlocksMargin: 5,
      })
      .buildWithoutStarting();

    const wallet = await MidnightWalletProvider.withWallet(
      logger,
      devnet,
      facade,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );
    await wallet.start();

    const zkConfigProvider = new NodeZkConfigProvider<TokenBurnCircuitId>(zkConfigPath);
    providers = {
      privateStateProvider: inMemoryPrivateStateProvider(),
      publicDataProvider: indexerPublicDataProvider(devnet.indexer, devnet.indexerWS),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(devnet.proofServer, zkConfigProvider),
      walletProvider: wallet,
      midnightProvider: wallet,
    };

    deployed = await deployContract(providers, {
      compiledContract: tokenBurnContract,
      args: [INITIAL_SUPPLY, BURN_RATE_BPS, owner.accountKey],
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: INITIAL_PRIVATE_STATE,
    });

    contractAddress = deployed.deployTxData.public.contractAddress;

    const l = await readLedger();
    expect(l.totalSupply).toBe(INITIAL_SUPPLY);
    expect(l.totalBurned).toBe(0n);
    expect(l.burnRateBps).toBe(BURN_RATE_BPS);

    const balances = await readBalances();
    expect(balances.get(owner.accountKeyHex)).toBe(INITIAL_SUPPLY);
  });

  it('voluntary burn removes the full amount from supply and balance', async () => {
    await deployed.callTx.burn(owner.sk, VOLUNTARY_BURN);

    const l = await readLedger();
    expect(l.totalSupply).toBe(INITIAL_SUPPLY - VOLUNTARY_BURN);
    expect(l.totalBurned).toBe(VOLUNTARY_BURN);

    const balances = await readBalances();
    expect(balances.get(owner.accountKeyHex)).toBe(INITIAL_SUPPLY - VOLUNTARY_BURN);
  });

  it('transfer burns the burn rate and credits the recipient', async () => {
    // NOTE: the compiled artifacts in contracts/managed/ (compact 0.31.1) are
    // OUT OF SYNC with contracts/token-burn.compact. The deployed transfer
    // charges the sender `amount + burn` and credits the recipient the full
    // `amount`; the source file instead deducts the burn from the amount the
    // recipient receives (and adds a self-transfer assert). Recompiling will
    // change these expectations.
    await deployed.callTx.transfer(owner.sk, recipient.accountKey, TRANSFER_AMOUNT);

    const l = await readLedger();
    expect(l.totalSupply).toBe(INITIAL_SUPPLY - VOLUNTARY_BURN - TRANSFER_BURN);
    expect(l.totalBurned).toBe(VOLUNTARY_BURN + TRANSFER_BURN);

    const balances = await readBalances();
    expect(balances.get(recipient.accountKeyHex)).toBe(TRANSFER_AMOUNT);
    expect(balances.get(owner.accountKeyHex)).toBe(
      INITIAL_SUPPLY - VOLUNTARY_BURN - TRANSFER_AMOUNT - TRANSFER_BURN,
    );
  });

  it('reconnecting via findDeployedContract preserves the private balances', async () => {
    const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    const found = await findDeployedContract(providers, {
      compiledContract: tokenBurnContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
    });

    const balances = await readBalances();
    expect(balances.get(recipient.accountKeyHex)).toBe(TRANSFER_AMOUNT);
    expect(balances.get(owner.accountKeyHex)).toBe(
      INITIAL_SUPPLY - VOLUNTARY_BURN - TRANSFER_AMOUNT - TRANSFER_BURN,
    );

    const l = await readLedger();
    expect(l.totalSupply).toBe(INITIAL_SUPPLY - VOLUNTARY_BURN - TRANSFER_BURN);
    expect(found.callTx).toBeDefined();
  });
});
