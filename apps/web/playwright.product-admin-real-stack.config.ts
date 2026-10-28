import { defineConfig, devices } from '@playwright/test'

import { activeTarget, outputPaths, testOptions } from './e2e/support/managed-target.mjs'

const config = defineConfig({
  ...outputPaths(),
  testDir: './e2e/product-admin-real-stack',
  testMatch:
    activeTarget().fixtureProfile === 'product-admin-oauth'
      ? [
          '**/product-admin-oauth*.spec.ts',
          '**/product-admin-review-c2.spec.ts',
          '**/product-admin-denied-loss.spec.ts',
        ]
      : activeTarget().fixtureProfile === 'product-admin-closed-signup'
        ? '**/product-admin-invitation.spec.ts'
        : activeTarget().fixtureProfile === 'product-admin-console-path'
          ? '**/product-admin-console-path.spec.ts'
          : '**/product-admin-host.spec.ts',
  fullyParallel: false,
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    ...testOptions(),
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'product-admin-real-stack', use: { ...devices['Desktop Chrome'] } }],
})

// AMCORE_CONSOLE_SUPPORT_MAIL_OPTIONS_START
if (['support-mail-path', 'support-mail-host'].includes(activeTarget().fixtureProfile ?? '')) {
  config.testMatch = '**/console-support-mail.spec.ts'
  config.retries = 0
  config.use = { ...config.use, trace: 'off', screenshot: 'off', video: 'off' }
}
// AMCORE_CONSOLE_SUPPORT_MAIL_OPTIONS_END

export default config
