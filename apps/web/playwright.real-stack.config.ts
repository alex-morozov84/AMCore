import { defineConfig, devices } from '@playwright/test'

/**
 * Track 7 FINAL PLAN §4 (`ai/models-talk.md`) — the real-stack lane, the
 * only one that proves auth/BFF/cookies/Redis/App Router end to end. A
 * separate config file, not a second project in `playwright.config.ts`:
 * this lane targets `docker-compose.yml`'s `local-infra` profile (real
 * Postgres, Redis, standalone `apps/web`, real `apps/api`, port 3000),
 * booted externally (`pnpm test:e2e:real-stack` / the `web-e2e` CI job) —
 * not something Playwright's own `webServer` should ever try to start or
 * reuse-detect against the unrelated `next dev` server on port 3002.
 */
export default defineConfig({
  testDir: './e2e/real-stack',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-real-stack' }]],
  use: {
    baseURL: 'http://localhost:3000',
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
