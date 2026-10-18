import { defineConfig, devices } from '@playwright/test'

import { activeTarget, outputPaths, testOptions } from './e2e/support/managed-target.mjs'

// The managed runner provisions a fresh local Docker stack and owns its cleanup.
// Playwright never reuses an unrelated development server.
let testDir =
  activeTarget().fixtureProfile === 'organization-setup'
    ? './e2e/organization-setup'
    : './e2e/real-stack'
// AMCORE_CONSOLE_PROVISIONING_TEST_DIR_START
if (activeTarget().fixtureProfile === 'organization-provisioning')
  testDir = './e2e/organization-provisioning'
// AMCORE_CONSOLE_PROVISIONING_TEST_DIR_END
export default defineConfig({
  ...outputPaths(),
  testDir,
  ...(activeTarget().fixtureProfile === 'organization-setup'
    ? { testMatch: '**/organization-initial-setup.spec.ts' }
    : {}),
  fullyParallel: false,
  // Fixture writes include live ownership/marker checks; browser assertions keep their own limits.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    ...testOptions(),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'real-stack',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
