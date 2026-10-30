import { expect, type Request, test } from '@playwright/test'

import { logoutViaApi, registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { activeTarget } from '../support/managed-target.mjs'

import { appleBrowserFixture } from './apple-browser-fixture'
import { getBrowserFixture } from './get-browser-fixture'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

for (const surface of ['site', 'admin'] as const) {
  for (const provider of ['google', 'apple'] as const) {
    test(`${surface} ${provider} callback wire privacy and selected completion`, async ({
      browser,
    }) => {
      const { product, staff } = activeTarget().origins
      if (!staff) throw new Error('Owned staff OAuth fixture required')
      const origin = surface === 'site' ? product : staff
      const base = `/api/${surface === 'admin' ? 'product-admin/' : ''}auth/oauth`
      const callback = `${base}/${provider}/callback`
      const context = await browser.newContext({ baseURL: product, ignoreHTTPSErrors: true })
      try {
        const page = await context.newPage()
        const email = uniqueEmail(`privacy-${surface}-${provider}`)
        await registerViaUi(page, email)
        expect((await logoutViaApi(context.request, product)).status()).toBe(200)
        for (const method of ['GET', 'POST', 'PATCH', 'HEAD']) {
          const response = await context.request.fetch(
            `${origin}${callback}?code=review-invalid&state=review-invalid`,
            { method, maxRedirects: 0 }
          )
          expect(response.status() >= 400 || response.status() === 303).toBe(true)
          expect(response.headers()['referrer-policy']).toBe('no-referrer')
        }
        const errorReferrers: (string | undefined)[] = []
        const errorReads: Promise<void>[] = []
        const captureError = (request: Request) => {
          const previous = request.redirectedFrom()
          if (
            (previous && new URL(previous.url()).pathname === callback) ||
            (surface === 'site' && new URL(request.url()).pathname === '/en/login')
          )
            errorReads.push(
              request.allHeaders().then((headers) => {
                errorReferrers.push(headers.referer)
              })
            )
        }
        page.on('request', captureError)
        // A controlled callback error is a real browser navigation, without a real grant.
        await page.goto(`${origin}${callback}?code=review-invalid&state=review-invalid`)
        if (surface === 'site') {
          await page.evaluate(() => location.assign('/en/login'))
          await page.waitForURL('**/en/login')
        }
        await Promise.all(errorReads)
        expect(errorReferrers).toEqual([undefined])
        page.off('request', captureError)
        const callbackPolicies: string[] = []
        const redirectedReferrers: (string | undefined)[] = []
        const documentPolicies: string[] = []
        const postPolicies: string[] = []
        const reads: Promise<void>[] = []
        page.on('response', (response) => {
          const path = new URL(response.url()).pathname
          if (path === callback) callbackPolicies.push(response.headers()['referrer-policy'])
          if (path === '/en/auth/callback')
            documentPolicies.push(response.headers()['referrer-policy'])
          if (path === `${base}/complete`) postPolicies.push(response.headers()['referrer-policy'])
        })
        page.on('request', (request) => {
          const previous = request.redirectedFrom()
          if (previous && new URL(previous.url()).pathname === callback)
            reads.push(
              request.allHeaders().then((headers) => {
                redirectedReferrers.push(headers.referer)
              })
            )
        })
        const seen =
          provider === 'apple'
            ? await appleBrowserFixture(context, origin, email, true, { surface })
            : await getBrowserFixture(context, origin, email, provider, surface)
        await page.goto(`${origin}${base}/${provider}`)
        await page.waitForURL(
          (url) =>
            url.origin === origin &&
            url.pathname === (surface === 'admin' ? '/en/organizations' : '/en'),
          { timeout: 15000 }
        )
        await Promise.all(reads)
        expect(seen()).toBe(true)
        expect(callbackPolicies).toEqual(['no-referrer'])
        expect(redirectedReferrers).toEqual([undefined])
        expect(documentPolicies).toEqual(['strict-origin'])
        expect(postPolicies).toEqual(['no-referrer'])
        expect((await context.request.get(`${origin}/api/auth/me`)).status()).toBe(200)
        const legacy = await context.request.get(
          `${product}/ru/organizations/org_review/invites?status=expired&page=2&search=hello&unrelated=drop`,
          { maxRedirects: 0 }
        )
        expect(legacy.status()).toBe(308)
        expect(legacy.headers()['referrer-policy']).toBe('no-referrer')
        const target = new URL(legacy.headers().location)
        expect(target.origin).toBe(staff)
        expect(Object.fromEntries(target.searchParams)).toEqual({
          page: '2',
          search: 'hello',
          status: 'expired',
        })
      } finally {
        await context.close()
      }
    })
  }
}
