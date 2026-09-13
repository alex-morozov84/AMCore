import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/console-real-stack',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-console-real-stack' }],
  ],
  use: {
    baseURL: 'https://console.localhost',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'console-real-stack', use: { ...devices['Desktop Chrome'] } }],
})
