import { defineConfig, devices } from '@playwright/test'

/**
 * Track 7 FINAL PLAN (`ai/models-talk.md`) splits E2E into lanes with
 * different infra costs, each its own Playwright project:
 *
 * - `mocked` (this PR): no real Postgres/Redis/`apps/api` — `page.route()`
 *   intercepts browser-originating requests. Runs against `next dev`.
 * - `server-mocked` (PR3): adds the `experimental.testProxy` fixture for
 *   server-side BFF boundaries `page.route()` cannot reach.
 * - `real-stack` (PR4): the full `docker-compose.yml` `local-infra` profile,
 *   the only lane that proves auth/BFF/cookies/Redis/App Router end to end.
 *
 * `server-mocked` shares the same dev server as `mocked` (both fine with
 * `experimental.testProxy` enabled, `next.config.ts` — interception is
 * opt-in per request via a header the msw testmode fixture injects, so it's
 * inert for every plain `mocked`-lane test). `real-stack` (PR4) still lands
 * separately: it targets a different, full-infra server entirely.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // AMCore ships a real PWA service worker (`public/sw.js`) — left
    // registered, it can intercept requests `page.route()` expects to see
    // first. Blocked for every project in this config, not just `mocked`:
    // no lane here needs the service worker's own behavior under test.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mocked',
      testDir: './e2e/mocked',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'server-mocked',
      testDir: './e2e/server-mocked',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_TEST_PROXY: 'true',
    },
  },
})
