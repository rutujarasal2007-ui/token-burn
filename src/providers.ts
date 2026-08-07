/**
 * Shared contract wiring for the Token Burn dApp (Node side).
 *
 * Builds the Midnight.js providers around a wallet context and reads the
 * contract's public ledger state through the indexer. The CLI scripts
 * (deploy.ts, cli.ts, check-balance.ts) reuse this module.
 */
import type { NetworkConfig } from './network';
import type { WalletContext } from './wallet';
import type {
  WalletProvider,
  MidnightProvider,
  PrivateStateProvider,
  PrivateStateId,
  PublicDataProvider,
  ProofProvider,
  ZKConfigProvider,
} from '@midnight-ntwrk/midnight-js-types';
import type { Contract as CompactContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { ledger, Contract } from '../contracts/managed/token-burn/contract/index.js';
import type { TokenBurnPrivateState } from '../contracts/witnesses.js';

export const PRIVATE_STATE_ID = 'tokenBurnPrivateState';

export const INITIAL_PRIVATE_STATE = { balances: new Map<string, bigint>() };

export type TokenBurnLedger = {
  totalSupply: bigint;
  totalBurned: bigint;
  burnRateBps: bigint;
};

export type TokenBurnContractType = Contract<TokenBurnPrivateState>;
export type TokenBurnCircuitId = CompactContract.ProvableCircuitId<TokenBurnContractType>;

export interface Providers<PCK extends string = string, PS = any> {
  privateStateProvider: PrivateStateProvider<PrivateStateId, PS>;
  publicDataProvider: PublicDataProvider;
  zkConfigProvider: ZKConfigProvider<PCK>;
  proofProvider: ProofProvider;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
}

export type TokenBurnProviders = Providers<TokenBurnCircuitId, TokenBurnPrivateState>;

export function createProviders(walletCtx: WalletContext, networkConfig: NetworkConfig, zkConfigPath: string): TokenBurnProviders {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    // Midnight.js 4.1.x returns the key objects (CoinPublicKey / EncPublicKey).
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx as never,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe as never);
    },
    submitTx: (tx: unknown) => walletCtx.wallet.submitTransaction(tx as never),
  };

  const zkConfigProvider = new NodeZkConfigProvider<TokenBurnCircuitId>(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'token-burn-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

/**
 * Read the contract's public ledger through the indexer. Returns null when
 * the contract has no indexed state yet.
 */
export async function readLedger(
  providers: Providers,
  contractAddress: string,
): Promise<TokenBurnLedger | null> {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return null;
  const l = ledger(contractState.data);
  return {
    totalSupply: l.totalSupply,
    totalBurned: l.totalBurned,
    burnRateBps: l.burnRateBps,
  };
}
