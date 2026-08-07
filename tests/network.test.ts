import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  NETWORK_IDS,
  isNetworkId,
  parseNetworkFlag,
  resolveNetwork,
  loadState,
  saveState,
  getOrCreateSeed,
  getDeployment,
  recordDeployment,
  setActiveNetwork,
  GENESIS_SEED,
  NETWORK_CONFIGS,
  STATE_VERSION,
  type NetworkState,
} from '../src/network';

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'token-burn-test-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('isNetworkId', () => {
  it('accepts every known network id', () => {
    for (const id of NETWORK_IDS) expect(isNetworkId(id)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isNetworkId('mainnet')).toBe(false);
    expect(isNetworkId(42)).toBe(false);
    expect(isNetworkId(null)).toBe(false);
  });
});

describe('parseNetworkFlag', () => {
  it('parses `--network <id>`', () => {
    expect(parseNetworkFlag(['node', 'file', '--network', 'preview'])).toBe('preview');
  });

  it('parses `--network=<id>`', () => {
    expect(parseNetworkFlag(['node', 'file', '--network=preprod'])).toBe('preprod');
  });

  it('returns null without a flag', () => {
    expect(parseNetworkFlag(['node', 'file'])).toBeNull();
  });

  it('throws on a missing value', () => {
    expect(() => parseNetworkFlag(['node', 'file', '--network'])).toThrow('requires a value');
  });

  it('throws on an unknown network', () => {
    expect(() => parseNetworkFlag(['node', 'file', '--network', 'mars'])).toThrow('Unknown network: mars');
  });
});

describe('loadState / saveState', () => {
  it('returns null when no state file exists', () => {
    expect(loadState({ cwd })).toBeNull();
  });

  it('round-trips a valid state', () => {
    const state: NetworkState = {
      version: STATE_VERSION,
      activeNetwork: 'preview',
      wallets: { preview: { seed: 'ab'.repeat(32), createdAt: '2026-01-01T00:00:00.000Z' } },
      deployments: {},
    };
    saveState(state, { cwd });
    expect(loadState({ cwd })).toEqual(state);
  });

  it('throws on a corrupt state file', () => {
    fs.writeFileSync(path.join(cwd, '.midnight-state.json'), '{not json');
    expect(() => loadState({ cwd })).toThrow('Failed to parse');
  });

  it('throws on an unsupported version', () => {
    fs.writeFileSync(
      path.join(cwd, '.midnight-state.json'),
      JSON.stringify({ version: 999, activeNetwork: 'undeployed' }),
    );
    expect(() => loadState({ cwd })).toThrow('Unsupported state-file version');
  });

  it('throws on an invalid activeNetwork', () => {
    fs.writeFileSync(
      path.join(cwd, '.midnight-state.json'),
      JSON.stringify({ version: STATE_VERSION, activeNetwork: 'mainnet' }),
    );
    expect(() => loadState({ cwd })).toThrow('Invalid activeNetwork');
  });
});

describe('resolveNetwork', () => {
  it('prefers the --network flag', () => {
    const r = resolveNetwork({ argv: ['node', 'file', '--network', 'preprod'], env: {}, cwd });
    expect(r).toMatchObject({ network: 'preprod', source: 'flag' });
    expect(r.config).toEqual(NETWORK_CONFIGS.preprod);
  });

  it('falls back to the persisted active network', () => {
    setActiveNetwork('preview', { cwd });
    const r = resolveNetwork({ argv: ['node', 'file'], env: {}, cwd });
    expect(r).toMatchObject({ network: 'preview', source: 'state' });
  });

  it('defaults to undeployed with no flag or state', () => {
    const r = resolveNetwork({ argv: ['node', 'file'], env: {}, cwd });
    expect(r).toMatchObject({ network: 'undeployed', source: 'default' });
  });

  it('applies environment overrides on top of the base config', () => {
    const r = resolveNetwork({
      argv: ['node', 'file'],
      env: { MIDNIGHT_INDEXER_URL: 'http://override:1/graphql' },
      cwd,
    });
    expect(r.config.indexer).toBe('http://override:1/graphql');
    expect(r.config.node).toBe(NETWORK_CONFIGS.undeployed.node);
  });

  it('does not mutate the shared base config when overriding', () => {
    resolveNetwork({
      argv: ['node', 'file'],
      env: { MIDNIGHT_INDEXER_URL: 'http://override:1/graphql' },
      cwd,
    });
    expect(NETWORK_CONFIGS.undeployed.indexer).toBe('http://127.0.0.1:8088/api/v4/graphql');
  });
});

describe('getOrCreateSeed', () => {
  it('always returns the genesis seed for undeployed', () => {
    expect(getOrCreateSeed('undeployed', { cwd })).toBe(GENESIS_SEED);
  });

  it('honours MIDNIGHT_WALLET_SEED for public networks', () => {
    const seed = getOrCreateSeed('preview', { env: { MIDNIGHT_WALLET_SEED: 'ff'.repeat(32) }, cwd });
    expect(seed).toBe('ff'.repeat(32));
  });

  it('persists a freshly generated seed for public networks', () => {
    const seed = getOrCreateSeed('preview', { env: {}, cwd });
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(getOrCreateSeed('preview', { env: {}, cwd })).toBe(seed);
  });
});

describe('recordDeployment / getDeployment', () => {
  it('records and reads back a deployment', () => {
    recordDeployment('undeployed', '00'.repeat(64), 'deployer', { cwd });
    const dep = getDeployment('undeployed', { cwd });
    expect(dep?.address).toBe('00'.repeat(64));
    expect(dep?.deployer).toBe('deployer');
    expect(typeof dep?.deployedAt).toBe('string');
  });

  it('keeps deployments per-network', () => {
    recordDeployment('undeployed', 'aa'.repeat(64), 'd1', { cwd });
    recordDeployment('preview', 'bb'.repeat(64), 'd2', { cwd });
    expect(getDeployment('undeployed', { cwd })?.address).toBe('aa'.repeat(64));
    expect(getDeployment('preview', { cwd })?.address).toBe('bb'.repeat(64));
  });

  it('returns null when nothing is recorded', () => {
    expect(getDeployment('preprod', { cwd })).toBeNull();
  });
});

describe('setActiveNetwork', () => {
  it('writes the active network to state', () => {
    setActiveNetwork('preprod', { cwd });
    expect(loadState({ cwd })?.activeNetwork).toBe('preprod');
  });

  it('is a no-op when the network is already active', () => {
    setActiveNetwork('preview', { cwd });
    const first = loadState({ cwd });
    setActiveNetwork('preview', { cwd });
    expect(loadState({ cwd })).toEqual(first);
  });
});
