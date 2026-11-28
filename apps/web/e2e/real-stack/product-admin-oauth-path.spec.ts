import { DEFAULT_LOCALE, productAdminPath } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { appleBrowserFixture } from '../product-admin-real-stack/apple-browser-fixture'
import { getBrowserFixture } from '../product-admin-real-stack/get-browser-fixture'
import { productPath } from '../shared/product-settings'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { logoutViaApi, registerViaUi, uniqueEmail } from './helpers'
import { pauseRedis, sessionRows, sleep, waitForRedisAfterPause } from './redis-outage-support'

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
            url.origin === product &&
            url.pathname === productPath(productAdminPath('/organizations')),
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

const STALL_MS = 8000
// CI uses the title as the case ID. The current contract is refusal, then an explicit retry.
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
    const userId = guardedSql("SELECT id FROM core.users WHERE email = :'email';", { email })
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    const rowsBefore = sessionRows(userId)
    const seen = await getBrowserFixture(context, product, email, 'google', 'admin')
    const start = `${product}/api/product-admin/auth/oauth/google?locale=${DEFAULT_LOCALE}`

    pauseRedis(STALL_MS)
    const started = performance.now()
    const refused = await context.request.get(start, { maxRedirects: 0, timeout: STALL_MS + 7000 })
    expect(refused.status()).toBe(303)
    expect(performance.now() - started).toBeLessThan(STALL_MS)
    const location = new URL(refused.headers().location!, product)
    expect(location.origin).toBe(product)
    expect(location.pathname).toBe(productPath(productAdminPath('/login')))
    expect(location.searchParams.get('oauthError')).toBe('OAUTH_PROVIDER_ERROR')
    expect(sessionRows(userId)).toBe(rowsBefore)

    await waitForRedisAfterPause(STALL_MS + 7000)
    expect(sessionRows(userId)).toBe(rowsBefore)
    expect((await context.request.get(`${product}/api/auth/me`)).status()).toBe(401)
    await page.goto(start)
    await page.waitForURL(
      (url) =>
        url.origin === product && url.pathname === productPath(productAdminPath('/organizations')),
      { timeout: STALL_MS + 15_000 }
    )
    expect(seen()).toBe(true)
    const me = await context.request.get(`${product}/api/auth/me`)
    expect(me.status()).toBe(200)
    expect((await me.json()).user.email).toBe(email)
  } finally {
    await context.close().catch(() => undefined)
  }
})

// The start leg is healthy; Redis stalls when the provider returns the browser to the callback.
// The callback reaches the API, whose one-time state step is refused fast: the browser lands on
// the sign-in page with a provider error, no backend session is created, and starting again after
// recovery signs in. Bounds are for this fault class on this machine, not guarantees.
test('google path administration callback during a Redis stall is refused, creates no session, and a restart signs in', async ({
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
    const email = uniqueEmail('path-callback-stall')
    await registerViaUi(page, email)
    const userId = guardedSql("SELECT id FROM core.users WHERE email = :'email';", { email })
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    const rowsBefore = sessionRows(userId)
    let pausedAt = 0
    const seen = await getBrowserFixture(context, product, email, 'google', 'admin', false, () => {
      if (pausedAt) return // only the first return from the provider is stalled
      pauseRedis(STALL_MS)
      pausedAt = performance.now()
    })
    const start = `${product}/api/product-admin/auth/oauth/google?locale=${DEFAULT_LOCALE}`
    await page.goto(start)
    await page.waitForURL((url) => url.searchParams.get('oauthError') !== null, {
      timeout: 10_000,
    })
    expect(performance.now() - pausedAt).toBeLessThan(STALL_MS) // refused inside the stall
    expect(new URL(page.url()).searchParams.get('oauthError')).toBe('OAUTH_PROVIDER_ERROR')
    expect(seen()).toBe(true)

    await sleep(STALL_MS + 2000 - (performance.now() - pausedAt))
    expect(sessionRows(userId)).toBe(rowsBefore) // the failed callback created no session
    expect((await context.request.get(`${product}/api/auth/me`)).status()).toBe(401)

    await page.goto(start)
    await page.waitForURL(
      (url) =>
        url.origin === product && url.pathname === productPath(productAdminPath('/organizations')),
      { timeout: 15_000 }
    )
    expect((await context.request.get(`${product}/api/auth/me`)).status()).toBe(200)
  } finally {
    await context.close().catch(() => undefined)
  }
})
