import { defineConfig } from 'vitest/config'

// Testcontainers-backed integration tests: real Redis (not the mocked client
// used by the default unit suite), proving the actual Lua scripts (CAS,
// lock release/renew) execute correctly — the default suite's mocked
// `eval()` never runs real Lua at all. Needs Docker; not part of `pnpm test`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
