/**
 * Compiled-contract binding: wires the compiled Token Burn artifacts together
 * with the witness implementations and the location of the ZK proving assets.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract } from './managed/token-burn/contract/index.js';
import { tokenBurnWitnesses, type TokenBurnPrivateState } from './witnesses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'token-burn');

export const tokenBurnContract = CompiledContract.make<Contract<TokenBurnPrivateState>>('token-burn', Contract<TokenBurnPrivateState>).pipe(
  CompiledContract.withWitnesses(tokenBurnWitnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
