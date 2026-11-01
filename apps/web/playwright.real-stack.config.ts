import { defineConfig, devices } from '@playwright/test'

import { activeTarget, outputPaths, testOptions } from './e2e/support/managed-target.mjs'

// The managed runner provisions a fresh local Docker stack and owns its cleanup.
// Playwright never reuses an unrelated development server.
const testDir =
  activeTarget().fixtureProfile === 'organization-setup'
    ? './e2e/organization-setup'
    : './e2e/real-stack'
export default defineConfig({
  ...outputPaths(),
  testDir,
  ...(activeTarget().fixtureProfile === 'organization-provisioning'
    ? { testDir: './e2e/organization-provisioning' }
    : {}),
  ...(activeTarget().fixtureProfile === 'organization-setup'
    ? { testMatch: '**/organization-initial-setup.spec.ts' }
    : {}),
  ...(activeTarget().fixtureProfile === 'product-admin-oauth-path'
    ? { testMatch: '**/product-admin-oauth-path.spec.ts' }
    : { testIgnore: '**/product-admin-oauth-path.spec.ts' }),
  fullyParallel: false,
  // Fixture writes include live ownership/marker checks; browser assertions keep their own limits.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  // Initial setup commits once; a retry requires a fresh managed database and Redis.
  retries: activeTarget().fixtureProfile === 'organization-setup' ? 0 : process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    ...testOptions(),
    trace: 'off',
    screenshot: 'off',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'real-stack',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
