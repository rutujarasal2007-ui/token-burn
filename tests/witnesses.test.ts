import { describe, it, expect } from 'vitest';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../contracts/managed/token-burn/contract/index.js';
import {
  bytesToHex,
  hexToBytes,
  tokenBurnWitnesses,
  type TokenBurnPrivateState,
} from '../contracts/witnesses.js';

function context(
  balances: Map<string, bigint>,
  burnRateBps: bigint,
): WitnessContext<Ledger, TokenBurnPrivateState> {
  return {
    ledger: { totalSupply: 0n, totalBurned: 0n, burnRateBps },
    privateState: { balances },
    contractAddress: null as unknown as WitnessContext<Ledger, TokenBurnPrivateState>['contractAddress'],
  };
}

// The witness keys accounts by bytesToHex(account), i.e. a 32-byte account
// rendered as 64 hex chars. Build the same key a witness would.
function accountKey(hex: string): string {
  return bytesToHex(hexToBytes(hex.padStart(64, '0')));
}

function accountBytes(hex: string): Uint8Array {
  return hexToBytes(hex.padStart(64, '0'));
}

describe('bytesToHex / hexToBytes', () => {
  it('round-trips a byte sequence', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x0a, 0xff, 0x80]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it('zero-pads single hex digits', () => {
    expect(bytesToHex(new Uint8Array([0x01, 0x0f, 0x1f]))).toBe('010f1f');
  });
});

describe('getBalance', () => {
  it('returns 0n for an unknown account', () => {
    const balances = new Map<string, bigint>();
    const [next, balance] = tokenBurnWitnesses.getBalance(context(balances, 0n), accountBytes('aa'));
    expect(balance).toBe(0n);
    expect(next.balances).toBe(balances);
  });

  it('returns the recorded balance for a known account', () => {
    const balances = new Map<string, bigint>([[accountKey('aa'), 100n]]);
    const [, balance] = tokenBurnWitnesses.getBalance(context(balances, 0n), accountBytes('aa'));
    expect(balance).toBe(100n);
  });

  it('is a pure read — never mutates the private state map', () => {
    const balances = new Map<string, bigint>();
    tokenBurnWitnesses.getBalance(context(balances, 0n), accountBytes('bb'));
    expect(balances.size).toBe(0);
  });
});

describe('applyBalance', () => {
  it('writes a balance and returns a fresh private state', () => {
    const balances = new Map<string, bigint>();
    const [next, result] = tokenBurnWitnesses.applyBalance(context(balances, 0n), accountBytes('aa'), 42n);
    expect(result).toEqual([]);
    expect(next.balances.get(accountKey('aa'))).toBe(42n);
    expect(next).not.toBe(balances as unknown as TokenBurnPrivateState);
  });

  it('does not mutate the caller-provided map', () => {
    const balances = new Map<string, bigint>([[accountKey('aa'), 1n]]);
    tokenBurnWitnesses.applyBalance(context(balances, 0n), accountBytes('aa'), 5n);
    expect(balances.get(accountKey('aa'))).toBe(1n);
  });

  it('overwrites an existing balance', () => {
    const balances = new Map<string, bigint>([[accountKey('aa'), 1n]]);
    const [next] = tokenBurnWitnesses.applyBalance(context(balances, 0n), accountBytes('aa'), 0n);
    expect(next.balances.get(accountKey('aa'))).toBe(0n);
  });
});

describe('computeBurn', () => {
  it('computes the burn at the configured rate (1% = 100 bps)', () => {
    const [next, burn] = tokenBurnWitnesses.computeBurn(context(new Map(), 100n), 1000n);
    expect(burn).toBe(10n);
    expect(next).toBeDefined();
  });

  it('truncates fractional burns (integer division)', () => {
    const [, burn] = tokenBurnWitnesses.computeBurn(context(new Map(), 100n), 999n);
    expect(burn).toBe(9n);
  });

  it('burns nothing at a 0 bps rate', () => {
    const [, burn] = tokenBurnWitnesses.computeBurn(context(new Map(), 0n), 5000n);
    expect(burn).toBe(0n);
  });

  it('uses the ledger burnRateBps, not the caller-supplied value', () => {
    const [, burn] = tokenBurnWitnesses.computeBurn(context(new Map(), 500n), 1000n);
    expect(burn).toBe(50n);
  });
});
