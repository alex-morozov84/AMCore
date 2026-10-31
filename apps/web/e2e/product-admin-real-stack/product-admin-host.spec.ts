import { expect, type Page, test } from '@playwright/test'

import { setSystemRole } from '../real-stack/admin-helpers'
import { logoutViaApi, registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { expectNoAxeViolations } from '../shared/axe'
import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget } from '../support/managed-target.mjs'
import { settingsProof } from '../support/runtime-settings-proof'

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

// Host-mode Console under a stalled session vault: the Console never admits anyone on unknown
// authority, copied product and staff cookies are not identities, the temporary page is the only
// difference an outsider can see, and the ordinary denial and the operator return after recovery.
test('Console host during a vault stall: copied cookies, invented cookie and operator', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const target = activeTarget()
  const { product, staff, console: consoleOrigin } = target.origins
  if (!staff || !consoleOrigin) throw new Error('Three-host staff fixture required')
  const TEMPORARY = /usually temporary|temporarily unavailable/i
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const context = await browser.newContext({ baseURL: product, ignoreHTTPSErrors: true })
  const outsider = await browser.newContext({ ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    const buyer = uniqueEmail('stall-buyer')
    const member = uniqueEmail('stall-member')
    const operator = uniqueEmail('stall-operator')
    for (const email of [buyer, member, operator]) {
      await registerViaUi(page, email)
      expect((await logoutViaApi(context.request, product)).status()).toBe(200)
    }
    setSystemRole(operator, 'SUPER_ADMIN')
    await login(page, consoleOrigin, operator)
    await login(page, staff, member)
    await login(page, product, buyer)
    expect((await context.request.get(`${consoleOrigin}/api/access`)).status()).toBe(204)

    // Outsider: a product cookie, a staff cookie and an invented value presented as the Console cookie.
    const productCookie = (await context.cookies(product)).find((c) => c.name === 'amcore_session')!
    const staffCookie = (await context.cookies(staff)).find(
      (c) => c.name === '__Host-amcore_staff_session'
    )!
    const present = async (value: string) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
      await ctx.addCookies([
        {
          name: '__Host-amcore_console_session',
          value,
          url: consoleOrigin,
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ])
      return ctx
    }
    const copies = [
      ['product', await present(productCookie.value)],
      ['staff', await present(staffCookie.value)],
      ['invented', await present('A'.repeat(43))],
    ] as const
    const denial = async () => {
      const out: Record<string, number> = {}
      for (const [name, ctx] of copies)
        out[name] = (
          await ctx.request.get(`${consoleOrigin}/api/access`, { timeout: 15_000 })
        ).status()
      out.anonymous = (
        await outsider.request.get(`${consoleOrigin}/api/access`, { timeout: 15_000 })
      ).status()
      return out
    }
    const healthy = await denial()
    expect(healthy).toEqual({ product: 401, staff: 401, invented: 401, anonymous: 401 })

    settingsProof('pause-redis')
    // Nobody is admitted while the vault is stalled; the operator is refused temporarily.
    const during = await denial()
    // Accepted disclosure limit: a copied or invented cookie starts vault admission and gets the
    // temporary refusal; without a cookie the plain denial stays.
    expect(during).toEqual({ product: 503, staff: 503, invented: 503, anonymous: 401 })
    const operatorAccess = await context.request.get(`${consoleOrigin}/api/access`, {
      timeout: 15_000,
    })
    expect(operatorAccess.status()).toBe(503)
    for (const [, ctx] of copies) {
      const copyPage = await ctx.newPage()
      await copyPage.goto(`${consoleOrigin}/en`, { timeout: 15_000 })
      forbiddenConsoleMarkup(await copyPage.content())
      await copyPage.close()
    }
    await page.goto(`${consoleOrigin}/en`, { timeout: 15_000 })
    await expect(page.getByText(TEMPORARY).first()).toBeVisible()
    forbiddenConsoleMarkup(await page.content())
    expect(await page.content()).not.toContain(operator)
    console.log('host console during stall', JSON.stringify({ healthy, during }))

    await sleep(42_000)
    await expect(async () => {
      const after = await denial()
      expect(after).toEqual({ product: 401, staff: 401, invented: 401, anonymous: 401 })
      expect((await context.request.get(`${consoleOrigin}/api/access`)).status()).toBe(204)
    }).toPass({ timeout: 60_000, intervals: [2000, 5000] })
  } finally {
    await context.close()
    await outsider.close()
  }
})

function forbiddenConsoleMarkup(html: string) {
  expect(html).not.toContain('data-slot="table"')
  expect(html).not.toContain('data-sidebar')
}
