import { defineConfig, devices } from '@playwright/test'

import { activeTarget, outputPaths, testOptions } from './e2e/support/managed-target.mjs'

export default defineConfig({
  ...outputPaths(),
  testDir:
    activeTarget().fixtureProfile === 'organization-setup'
      ? './e2e/organization-setup'
      : './e2e/console-real-stack',
  ...(activeTarget().fixtureProfile === 'organization-setup'
    ? { testMatch: '**/console-organization-setup.spec.ts' }
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
  projects: [{ name: 'console-real-stack', use: { ...devices['Desktop Chrome'] } }],
})
