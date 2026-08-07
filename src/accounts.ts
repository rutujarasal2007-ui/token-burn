/**
 * Token accounts for the Token Burn dApp.
 *
 * Every token account is identified by a 32-byte *secret key* (sk) whose
 * public identity is `accountKey(sk)` — a hash computed inside the contract
 * (`persistentHash(pad("token-burn:account:"), sk)`). The secret key never
 * leaves the operator; the account key is the shareable address.
 *
 * For the bootcamp demo, account secrets are derived *deterministically*
 * from the wallet seed: `sk_i = sha256(seed || ":" || index)`. No secret
 * material is persisted anywhere — any account can be reconstructed from
 * (seed, index). The operator wallet holds the authoritative balances map
 * in its private state.
 */
import { createHash } from 'node:crypto';
import { pureCircuits } from '../contracts/managed/token-burn/contract/index.js';
import { bytesToHex } from '../contracts/witnesses.js';

export const OWNER_ACCOUNT_INDEX = 0;

/**
 * Derive the 32-byte token secret key for the account at the given index.
 */
export function deriveTokenSk(seed: string, index: number): Uint8Array {
  const digest = createHash('sha256').update(`${seed}:token-burn-account:${index}`).digest();
  return digest.subarray(0, 32);
}

/**
 * Compute the public account key for a token secret key using the contract's
 * own `accountKey` pure circuit — the exact same derivation the circuit uses.
 */
export function accountKeyOf(sk: Uint8Array): Uint8Array {
  return pureCircuits.accountKey(sk);
}

/**
 * Hex-encoded public account key for a token secret key.
 */
export function accountKeyHexOf(sk: Uint8Array): string {
  return bytesToHex(accountKeyOf(sk));
}

export type TokenAccount = {
  index: number;
  sk: Uint8Array;
  accountKey: Uint8Array;
  accountKeyHex: string;
};

/**
 * Build a token account object for the given index.
 */
export function tokenAccount(seed: string, index: number): TokenAccount {
  const sk = deriveTokenSk(seed, index);
  const accountKey = accountKeyOf(sk);
  return { index, sk, accountKey, accountKeyHex: bytesToHex(accountKey) };
}
