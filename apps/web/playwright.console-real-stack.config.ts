import { defineConfig, devices } from '@playwright/test'

import { outputPaths, testOptions } from './e2e/support/managed-target.mjs'

export default defineConfig({
  ...outputPaths(),
  testDir: './e2e/console-real-stack',
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
