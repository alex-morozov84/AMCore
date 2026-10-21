import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { activeTarget } from '../support/managed-target.mjs'

import { appleBrowserFixture } from './apple-browser-fixture'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

for (const automatic of [true, false]) {
  test(`signed Apple completion ${automatic ? 'automatic' : 'without JavaScript'} retains Strict cookie and exact Origin`, async ({
    browser,
  }) => {
    const { product, staff } = activeTarget().origins
    if (!staff) throw new Error('Staff OAuth fixture required')
    const setup = await browser.newContext({
      baseURL: product,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    const member = uniqueEmail('apple-member')
    const buyer = uniqueEmail('apple-buyer')
    try {
      const page = await setup.newPage()
      await registerViaUi(page, member)
      expect(
        (
          await setup.request.post(`${product}/api/auth/logout`, { headers: { Origin: product } })
        ).status()
      ).toBe(200)
      await registerViaUi(page, buyer)
      const context = automatic
        ? setup
        : await browser.newContext({
            baseURL: product,
            ignoreHTTPSErrors: true,
            serviceWorkers: 'block',
            javaScriptEnabled: false,
            storageState: await setup.storageState(),
          })
      try {
        const activePage = automatic ? page : await context.newPage()
        const authorizationSeen = await appleBrowserFixture(context, staff, member, automatic)
        const observations: Promise<void>[] = []
        let getSent = false
        let postSent = false
        let postOrigin: string | undefined
        let postReferer: string | undefined
        let documentPolicy: string | undefined
        let completionStatus: number | undefined
        activePage.on('request', (request) => {
          const url = new URL(request.url())
          if (url.origin !== staff) return
          if (
            url.pathname === '/en/auth/callback' ||
            url.pathname === '/api/product-admin/auth/oauth/complete'
          )
            observations.push(
              request.allHeaders().then((headers) => {
                const sent = /(?:^|;\s*)__Host-amcore_admin_oauth_refresh=/.test(
                  headers.cookie ?? ''
                )
                if (request.method() === 'POST') {
                  postSent = sent
                  postOrigin = headers.origin
                  postReferer = headers.referer
                } else getSent = sent
              })
            )
        })
        activePage.on('response', (response) => {
          const url = new URL(response.url())
          if (url.origin !== staff) return
          if (url.pathname === '/en/auth/callback')
            documentPolicy = response.headers()['referrer-policy']
          if (url.pathname === '/api/product-admin/auth/oauth/complete')
            completionStatus = response.status()
        })
        await activePage.goto(`${staff}/en/organizations?view=list`)
        await activePage.getByRole('link', { name: /continue with apple/i }).click()
        if (!automatic) {
          await activePage
            .getByRole('link', { name: 'Continue to fixture provider', exact: true })
            .click()
          await activePage.getByRole('button', { name: 'Authorize fixture', exact: true }).click()
          await expect(
            activePage.getByRole('heading', { name: 'Completing sign-in…' })
          ).toBeVisible()
          await activePage.getByRole('button', { name: 'Continue', exact: true }).click()
        }
        try {
          await activePage.waitForURL(
            (url) =>
              url.origin === staff &&
              (url.pathname === '/en/organizations' || url.searchParams.has('oauthError')),
            { timeout: 15000 }
          )
        } catch {
          throw new Error('Selected Apple completion did not reach a terminal destination')
        }
        expect(new URL(activePage.url()).pathname).toBe('/en/organizations')
        await Promise.all(observations)
        expect(authorizationSeen()).toBe(true)
        // Assert only safe metadata, never transient cookie values or ticket URLs.
        expect({
          getSent,
          postSent,
          postOrigin,
          postReferer,
          documentPolicy,
          completionStatus,
        }).toEqual({
          getSent: false,
          postSent: true,
          postOrigin: staff,
          postReferer: `${staff}/`,
          documentPolicy: 'strict-origin',
          completionStatus: 303,
        })
        expect(new URL(activePage.url()).searchParams.get('view')).toBe('list')
        for (const [origin, email] of [
          [product, buyer],
          [staff, member],
        ]) {
          const response = await context.request.get(`${origin}/api/auth/me`)
          expect(response.status()).toBe(200)
          expect((await response.json()).user.email).toBe(email)
        }
        const names = (await context.cookies(staff)).map((cookie) => cookie.name)
        expect(names).toContain('__Host-amcore_staff_session')
        expect(
          names.some((name) =>
            ['access_token', 'refresh_token', '__Host-amcore_admin_oauth_refresh'].includes(name)
          )
        ).toBe(false)
      } finally {
        if (context !== setup) await context.close()
      }
    } finally {
      await setup.close()
    }
  })
}
