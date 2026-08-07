/**
 * Private-state type and witness implementations for the Token Burn contract.
 *
 * The private state is a map from account key (hex-encoded) to balance. It
 * never leaves the wallet that runs the contract: witnesses feed it into the
 * ZK circuits, and only zero-knowledge proofs reach the chain.
 */
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './managed/token-burn/contract/index.js';

export type TokenBurnPrivateState = {
  readonly balances: Map<string, bigint>;
};

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export const tokenBurnWitnesses = {
  getBalance(
    context: WitnessContext<Ledger, TokenBurnPrivateState>,
    account: Uint8Array,
  ): [TokenBurnPrivateState, bigint] {
    const key = bytesToHex(account);
    return [context.privateState, context.privateState.balances.get(key) ?? 0n];
  },

  applyBalance(
    context: WitnessContext<Ledger, TokenBurnPrivateState>,
    account: Uint8Array,
    newBalance: bigint,
  ): [TokenBurnPrivateState, []] {
    const next: TokenBurnPrivateState = {
      balances: new Map(context.privateState.balances),
    };
    next.balances.set(bytesToHex(account), newBalance);
    return [next, []];
  },

  computeBurn(
    context: WitnessContext<Ledger, TokenBurnPrivateState>,
    amount: bigint,
  ): [TokenBurnPrivateState, bigint] {
    const rateBps = context.ledger.burnRateBps;
    const burn = (amount * rateBps) / 10000n;
    return [context.privateState, burn];
  },
};
