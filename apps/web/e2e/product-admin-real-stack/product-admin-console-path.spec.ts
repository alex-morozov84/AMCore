import { expect, test } from '@playwright/test'

import { setSystemRole } from '../real-stack/admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
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
    expect(
      (await context.request.post('/api/auth/logout', { headers: { Origin: product } })).status()
    ).toBe(200)
    setSystemRole(email, 'SUPER_ADMIN')
    await loginViaUi(page, email)
    await page.waitForURL((url) => url.origin === product && url.pathname === '/en')
    expect((await context.request.get(`${product}/api/console/access`)).status()).toBe(204)
    await page.goto(`${staff}/en/login`)
    await page.getByRole('textbox', { name: /email/i }).fill(email)
    await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible()
    expect((await context.request.get(`${staff}/api/console/access`)).status()).toBe(404)
    expect(
      (
        await context.request.post(`${product}/api/auth/logout`, { headers: { Origin: product } })
      ).status()
    ).toBe(200)
    expect((await context.request.get(`${product}/api/console/access`)).status()).toBe(401)
    expect((await context.request.get(`${staff}/api/auth/me`)).status()).toBe(200)
  } finally {
    await context.close()
  }
})
