import { expect, type Page, test } from '@playwright/test'

import { setSystemRole } from '../real-stack/admin-helpers'
import { logoutViaApi, registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { expectNoAxeViolations } from '../shared/axe'
import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget } from '../support/managed-target.mjs'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

async function login(page: Page, origin: string, email: string) {
  await page.goto(`${origin}/en/login`)
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  const signIn = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /sign in/i }).click()
  if ((await signIn).status() === 202) await completeMfaSignIn(page, email)
  await page.waitForURL((url) => url.origin === origin && !url.pathname.endsWith('/login'))
}

test('one browser preserves product, staff and Console identities and contains copied cookies', async ({
  browser,
}) => {
  const target = activeTarget()
  const { product, staff, console: consoleOrigin } = target.origins
  if (!staff || !consoleOrigin) throw new Error('Three-host staff fixture required')
  expect(consoleOrigin).toBeTruthy()
  const context = await browser.newContext({ baseURL: product, ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    const buyer = uniqueEmail('placement-buyer')
    const member = uniqueEmail('placement-member')
    const operator = uniqueEmail('placement-operator')
    for (const email of [buyer, member, operator]) {
      await registerViaUi(page, email)
      expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    }
    setSystemRole(operator, 'SUPER_ADMIN')
    await login(page, consoleOrigin, operator)
    await login(page, staff, member)
    await login(page, product, buyer)
    for (const [origin, email] of [
      [product, buyer],
      [staff, member],
    ]) {
      const response = await context.request.get(`${origin}/api/auth/me`)
      expect(response.status()).toBe(200)
      expect((await response.json()).user.email).toBe(email)
    }
    expect((await context.request.get(`${consoleOrigin}/api/access`)).status()).toBe(204)
    const staffCookie = (await context.cookies(staff)).find(
      (c) => c.name === '__Host-amcore_staff_session'
    )!
    const { secure, httpOnly, sameSite, path, domain } = staffCookie
    expect({ secure, httpOnly, sameSite, path, domain }).toEqual({
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      domain: new URL(staff).hostname,
    })
    expect(
      (await context.cookies()).some((c) => ['refresh_token', 'access_token'].includes(c.name))
    ).toBe(false)
    expect(
      (
        await context.request.post(`${staff}/api/product-admin/auth/logout`, {
          headers: { Origin: product },
        })
      ).status()
    ).toBe(403)
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    expect((await context.request.get(`${staff}/api/auth/me`)).status()).toBe(200)
    expect((await context.request.get(`${consoleOrigin}/api/access`)).status()).toBe(204)
    await login(page, product, member)
    expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    expect((await context.request.get(`${staff}/api/auth/me`)).status()).toBe(200)
    const current = (await context.cookies(staff)).find((c) => c.name === staffCookie.name)
    expect(current?.value === staffCookie.value).toBe(true)
    const transplanted = await browser.newContext({ ignoreHTTPSErrors: true })
    try {
      await transplanted.addCookies([
        { ...staffCookie, name: 'amcore_session', domain: new URL(product).hostname },
      ])
      expect((await transplanted.request.get(`${product}/api/auth/me`)).status()).toBe(401)
    } finally {
      await transplanted.close()
    }
    await page.goto(`${staff}/en/organizations/not-present-placement/members`)
    await expect(page.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: /sign out/i }).click()
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    expect((await context.request.get(`${consoleOrigin}/api/access`)).status()).toBe(204)
  } finally {
    await context.close()
  }
})

test('host edge rejects physical/unknown routes, preserves safe login and assets', async ({
  page,
  request,
}) => {
  const { product, staff } = activeTarget().origins
  if (!staff) throw new Error('Staff fixture required')
  for (const origin of [product, staff])
    expect((await request.get(`${origin}/en/manage/organizations`)).status()).toBe(404)
  expect((await request.get(`${staff}/en/unknown-placement-page`)).status()).toBe(404)
  expect((await request.get(`${staff}/api/auth/login`)).status()).toBe(404)
  expect((await request.get(`${staff}/favicon.ico`)).status()).toBe(200)
  await page.goto('/en/organizations?view=list')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0)
  await expectNoAxeViolations(page)
})
