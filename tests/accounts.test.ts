import { describe, it, expect } from 'vitest';
import {
  OWNER_ACCOUNT_INDEX,
  accountKeyHexOf,
  accountKeyOf,
  deriveTokenSk,
  tokenAccount,
} from '../src/accounts';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f90001112131415161718191a1b1c1d1e1f20';

describe('deriveTokenSk', () => {
  it('derives a 32-byte key deterministically', () => {
    const a = deriveTokenSk(SEED, 0);
    const b = deriveTokenSk(SEED, 0);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
  });

  it('derives distinct keys for distinct indices', () => {
    const a = deriveTokenSk(SEED, 0);
    const b = deriveTokenSk(SEED, 1);
    expect(a).not.toEqual(b);
  });

  it('derives distinct keys for distinct seeds', () => {
    const a = deriveTokenSk(SEED, 0);
    const b = deriveTokenSk('f'.repeat(64), 0);
    expect(a).not.toEqual(b);
  });
});

describe('accountKeyOf', () => {
  it('maps a secret key to a 32-byte public key', () => {
    const sk = deriveTokenSk(SEED, 0);
    const pub = accountKeyOf(sk);
    expect(pub).toHaveLength(32);
  });

  it('is deterministic', () => {
    const sk = deriveTokenSk(SEED, 0);
    expect(accountKeyOf(sk)).toEqual(accountKeyOf(sk));
  });

  it('differs for different secret keys', () => {
    expect(accountKeyOf(deriveTokenSk(SEED, 0))).not.toEqual(accountKeyOf(deriveTokenSk(SEED, 1)));
  });

  it('renders as a 64-char hex string', () => {
    expect(accountKeyHexOf(deriveTokenSk(SEED, 0))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tokenAccount', () => {
  it('builds a consistent account record', () => {
    const acc = tokenAccount(SEED, 3);
    expect(acc.index).toBe(3);
    expect(acc.sk).toHaveLength(32);
    expect(acc.accountKey).toHaveLength(32);
    expect(acc.accountKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.accountKeyHex).toBe(bytesToHexLower(acc.accountKey));
  });

  it('is deterministic across calls', () => {
    expect(tokenAccount(SEED, 2)).toEqual(tokenAccount(SEED, 2));
  });

  it('assigns different addresses to different indices', () => {
    expect(tokenAccount(SEED, 0).accountKeyHex).not.toBe(tokenAccount(SEED, 1).accountKeyHex);
  });

  it('exports the owner account index as 0', () => {
    expect(OWNER_ACCOUNT_INDEX).toBe(0);
    expect(tokenAccount(SEED, OWNER_ACCOUNT_INDEX).index).toBe(0);
  });
});

function bytesToHexLower(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
