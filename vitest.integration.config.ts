import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Chain interactions (devnet transactions, proof generation) are slow.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    maxWorkers: 1,
    singleThread: true,
    reporters: ['default'],
    include: ['tests/integration/**/*.test.ts'],
  },
});
