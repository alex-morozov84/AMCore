import { DEFAULT_LOCALE, productAdminPath } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { appleBrowserFixture } from '../product-admin-real-stack/apple-browser-fixture'
import { getBrowserFixture } from '../product-admin-real-stack/get-browser-fixture'
import { activeTarget } from '../support/managed-target.mjs'

import { logoutViaApi, registerViaUi, uniqueEmail } from './helpers'
import { pauseRedis } from './redis-outage-support'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

for (const provider of ['apple', 'google', 'github'] as const) {
  test(`${provider} path administration publishes the shared website session`, async ({
    browser,
  }) => {
    const { product } = activeTarget().origins
    const context = await browser.newContext({
      baseURL: product,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    try {
      const page = await context.newPage()
      const email = uniqueEmail(`path-${provider}`)
      await registerViaUi(page, email)
      expect((await logoutViaApi(context.request, product)).status()).toBe(200)
      const seen =
        provider === 'apple'
          ? await appleBrowserFixture(context, product, email)
          : await getBrowserFixture(context, product, email, provider, 'admin')
      await page.goto(
        `${product}/api/product-admin/auth/oauth/${provider}?locale=${DEFAULT_LOCALE}`
      )
      try {
        await page.waitForURL(
          (url) =>
            url.origin === product && url.pathname === `/en${productAdminPath('/organizations')}`,
          { timeout: 15000 }
        )
      } catch {
        throw new Error('Path OAuth did not reach its canonical administration destination')
      }
      expect(seen()).toBe(true)
      const me = await context.request.get(`${product}/api/auth/me`)
      expect(me.status()).toBe(200)
      expect((await me.json()).user.email).toBe(email)
      const names = (await context.cookies(product)).map((cookie) => cookie.name)
      expect(names).toContain('amcore_session')
      expect(names).not.toContain('__Host-amcore_staff_session')
      expect(names).not.toContain('__Host-amcore_admin_oauth_refresh')
      expect((await logoutViaApi(context.request, product)).status()).toBe(200)
      expect((await context.request.get(`${product}/api/auth/me`)).status()).toBe(401)
    } finally {
      await context.close().catch(() => undefined)
    }
  })
}

// Characterization, not a 3 s promise: the web server keeps OAuth attempt records on its shared Redis
// connection (only the session vault, its lock and the refresh moved to the supervised one). A flow
// started while Redis stalls waits for the stall to end and then signs in; no session exists
// before that. The API's own typed 503 for OAuth start and exchange is covered by its e2e suite.
// Numbers are for this fault class on this machine.
const STALL_MS = 8000
test('google path administration started during a Redis stall waits for Redis, then signs in', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const { product } = activeTarget().origins
  const context = await browser.newContext({
    baseURL: product,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  try {
    const page = await context.newPage()
    const email = uniqueEmail('path-stall')
    await registerViaUi(page, email)
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    const seen = await getBrowserFixture(context, product, email, 'google', 'admin')
    const start = `${product}/api/product-admin/auth/oauth/google?locale=${DEFAULT_LOCALE}`

    pauseRedis(STALL_MS)
    const started = performance.now()
    await page.goto(start, { timeout: STALL_MS + 15_000 })
    await page.waitForURL(
      (url) =>
        url.origin === product && url.pathname === `/en${productAdminPath('/organizations')}`,
      { timeout: STALL_MS + 15_000 }
    )
    expect(performance.now() - started).toBeLessThan(STALL_MS + 15_000)
    expect(seen()).toBe(true)
    const me = await context.request.get(`${product}/api/auth/me`)
    expect(me.status()).toBe(200)
    expect((await me.json()).user.email).toBe(email)
  } finally {
    await context.close().catch(() => undefined)
  }
})
