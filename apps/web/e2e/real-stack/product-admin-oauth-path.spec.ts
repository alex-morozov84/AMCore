import { productAdminPath } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { appleBrowserFixture } from '../product-admin-real-stack/apple-browser-fixture'
import { getBrowserFixture } from '../product-admin-real-stack/get-browser-fixture'
import { activeTarget } from '../support/managed-target.mjs'

import { registerViaUi, uniqueEmail } from './helpers'

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
      expect(
        (
          await context.request.post(`${product}/api/auth/logout`, { headers: { Origin: product } })
        ).status()
      ).toBe(200)
      const seen =
        provider === 'apple'
          ? await appleBrowserFixture(context, product, email)
          : await getBrowserFixture(context, product, email, provider, 'admin')
      await page.goto(`${product}/api/product-admin/auth/oauth/${provider}?locale=en`)
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
      expect(
        (
          await context.request.post(`${product}/api/auth/logout`, { headers: { Origin: product } })
        ).status()
      ).toBe(200)
      expect((await context.request.get(`${product}/api/auth/me`)).status()).toBe(401)
    } finally {
      await context.close().catch(() => undefined)
    }
  })
}
