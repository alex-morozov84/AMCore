import { expect, test } from '@playwright/test'

import { setSystemRole } from '../real-stack/admin-helpers'
import {
  loginViaUi,
  logoutViaApi,
  registerViaUi,
  TEST_PASSWORD,
  uniqueEmail,
} from '../real-stack/helpers'
import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget } from '../support/managed-target.mjs'

test('staff remains independent when Console shares the website path session', async ({
  browser,
}) => {
  const { product, staff } = activeTarget().origins
  if (!staff) throw new Error('Staff host required')
  const context = await browser.newContext({ baseURL: product, ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    const email = uniqueEmail('console-path-staff')
    await registerViaUi(page, email)
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    setSystemRole(email, 'SUPER_ADMIN')
    await loginViaUi(page, email)
    await page.waitForURL((url) => url.origin === product && url.pathname === '/en')
    expect((await context.request.get(`${product}/api/console/access`)).status()).toBe(204)
    await page.goto(`${staff}/en/login`)
    await page.getByRole('textbox', { name: /email/i }).fill(email)
    await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
    const signIn = page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
    )
    await page.getByRole('button', { name: /sign in/i }).click()
    if ((await signIn).status() === 202) await completeMfaSignIn(page, email)
    await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible()
    expect((await context.request.get(`${staff}/api/console/access`)).status()).toBe(404)
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    expect((await context.request.get(`${product}/api/console/access`)).status()).toBe(401)
    expect((await context.request.get(`${staff}/api/auth/me`)).status()).toBe(200)
  } finally {
    await context.close()
  }
})
