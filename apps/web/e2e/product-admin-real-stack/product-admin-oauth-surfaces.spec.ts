import { expect, type Page, test } from '@playwright/test'

import { logoutViaApi, registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { appleBrowserFixture } from './apple-browser-fixture'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

async function terminal(page: Page, match: (url: URL) => boolean) {
  try {
    await page.waitForURL(match, { timeout: 15000 })
  } catch {
    throw new Error('OAuth surface did not reach its controlled terminal destination')
  }
}

function accountCounts(email: string) {
  return guardedSql(
    `SELECT (SELECT count(*) FROM core.users WHERE "emailCanonical"=:'email'),
      (SELECT count(*) FROM core.oauth_accounts a JOIN core.users u ON u.id=a."userId" WHERE u."emailCanonical"=:'email'),
      (SELECT count(*) FROM core.sessions s JOIN core.users u ON u.id=s."userId" WHERE u."emailCanonical"=:'email');`,
    { email }
  ).trim()
}

test('site Apple completion creates one verified identity and preserves first form_post name', async ({
  browser,
}) => {
  const { product } = activeTarget().origins
  const context = await browser.newContext({
    baseURL: product,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  const email = uniqueEmail('apple-first-profile')
  try {
    const page = await context.newPage()
    const seen = await appleBrowserFixture(context, product, email, true, { surface: 'site' })
    // The website UI currently exposes Google only; test its existing Apple transport directly.
    await page.goto(`${product}/api/auth/oauth/apple`)
    await terminal(page, (url) => url.origin === product && url.pathname === '/en')
    expect(seen()).toBe(true)
    const response = await context.request.get(`${product}/api/auth/me`)
    expect(response.status()).toBe(200)
    const { user } = await response.json()
    expect({ email: user.email, name: user.name, verified: user.emailVerified }).toEqual({
      email,
      name: 'Fixture Member',
      verified: true,
    })
    expect(accountCounts(email)).toBe('1|1|1')
    expect((await context.cookies(product)).some((cookie) => cookie.name === 'refresh_token')).toBe(
      false
    )
  } finally {
    await context.close().catch(() => undefined)
  }
})

for (const scenario of [
  'signature',
  'issuer',
  'audience',
  'expired',
  'missing',
  'subject',
  'missing-email',
  'email-type',
  'verified-type',
  'unverified',
]) {
  test(`site Apple rejects ${scenario} before account or session creation`, async ({ browser }) => {
    const { product } = activeTarget().origins
    const context = await browser.newContext({
      baseURL: product,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    const email = uniqueEmail(`apple-reject-${scenario}`)
    try {
      const page = await context.newPage()
      if (scenario === 'unverified') {
        await registerViaUi(page, email)
        expect((await logoutViaApi(context.request, product)).status()).toBe(200)
      }
      const before = accountCounts(email)
      const seen = await appleBrowserFixture(context, product, email, true, {
        surface: 'site',
        scenario,
      })
      // Preserve the site's existing pre-ticket API-error contract. Admin errors use login redirects.
      const rejected = page.waitForResponse(
        (response) => {
          const url = new URL(response.url())
          return (
            url.origin === product &&
            url.pathname === '/api/auth/oauth/apple/callback' &&
            response.status() >= 400
          )
        },
        { timeout: 15000 }
      )
      await page.goto(`${product}/api/auth/oauth/apple`)
      expect((await rejected).status()).toBeGreaterThanOrEqual(400)
      expect(seen()).toBe(true)
      expect((await context.request.get(`${product}/api/auth/me`)).status()).toBe(401)
      expect(accountCounts(email)).toBe(before)
    } finally {
      await context.close().catch(() => undefined)
    }
  })
}

test('ordinary staff Apple login cannot register a new account', async ({ browser }) => {
  const { staff } = activeTarget().origins
  if (!staff) throw new Error('Staff OAuth fixture required')
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' })
  const email = uniqueEmail('apple-staff-new')
  try {
    const page = await context.newPage()
    const seen = await appleBrowserFixture(context, staff, email)
    await page.goto(`${staff}/en/login`)
    await page.getByRole('link', { name: /continue with apple/i }).click()
    await terminal(
      page,
      (url) =>
        url.origin === staff && url.pathname === '/en/login' && url.searchParams.has('oauthError')
    )
    expect(seen()).toBe(true)
    expect((await context.request.get(`${staff}/api/auth/me`)).status()).toBe(401)
    expect(accountCounts(email)).toBe('0|0|0')
  } finally {
    await context.close().catch(() => undefined)
  }
})
