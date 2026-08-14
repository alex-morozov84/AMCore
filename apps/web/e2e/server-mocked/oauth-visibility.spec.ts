import { test } from 'next/experimental/testmode/playwright/msw'
import { expect } from '@playwright/test'
import { http, HttpResponse } from 'msw'

/**
 * `getOAuthProviders()` (`shared/api/bff/oauth-providers.ts`) is a
 * server-side `fetch` from the Next server to `apps/api` — a boundary
 * `page.route()` (the `mocked` lane) cannot reach, since nothing crosses
 * the browser. Next's own `experimental/testmode/playwright/msw` fixture
 * intercepts it instead, via `next.config.ts`'s `experimental.testProxy`
 * (only enabled under this Playwright project's `webServer.env`).
 *
 * Proven against this exact page and endpoint in the Track 7 spike before
 * being adopted (`ai/models-talk.md` — "Spike results"): the fixture worked
 * on the first real attempt, both against `next dev` and, after a since-
 * documented standalone file-tracing workaround, the production build.
 */

test('shows the Google entry point when the backend reports it configured', async ({
  page,
  msw,
}) => {
  msw.use(
    http.get('http://localhost:5002/api/v1/auth/oauth/providers', () =>
      HttpResponse.json({ providers: ['google'] })
    )
  )

  await page.goto('/en/login')
  await expect(page.getByRole('link', { name: /continue with google/i })).toBeVisible()
})

test('hides the Google entry point when no provider is configured', async ({ page, msw }) => {
  msw.use(
    http.get('http://localhost:5002/api/v1/auth/oauth/providers', () =>
      HttpResponse.json({ providers: [] })
    )
  )

  await page.goto('/en/login')
  await expect(page.getByRole('link', { name: /continue with google/i })).toHaveCount(0)
})
