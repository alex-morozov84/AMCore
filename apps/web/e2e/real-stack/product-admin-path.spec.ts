import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_LOCALE,
  localizedFrontendUrl,
  PRODUCT_ADMIN_CONFIG,
  productAdminPath,
  SERVED_LOCALES,
} from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { closeCredentialPage } from '../shared/credential-artifacts'
import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget } from '../support/managed-target.mjs'

import {
  ensureAdministrationSession,
  logoutViaApi,
  productAdministrationOrigin,
  registerViaUi,
  TEST_PASSWORD,
  uniqueEmail,
} from './helpers'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.afterEach(async ({ page }, info) => closeCredentialPage(page, info))

test('path administration shares website login/logout and preserves a localized protected destination', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  const { product } = target.origins
  const origin = productAdministrationOrigin()
  const separate = PRODUCT_ADMIN_CONFIG.mode === 'host'
  const chosen = SERVED_LOCALES.find((locale: string) => locale === 'ru') ?? DEFAULT_LOCALE
  const catalogue = (locale: string) =>
    JSON.parse(readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8'))
  const baseCopy = catalogue(DEFAULT_LOCALE)
  const copy = catalogue(chosen)
  const admin = (locale: typeof DEFAULT_LOCALE, suffix: string) =>
    localizedFrontendUrl(origin, locale, productAdminPath(suffix))
  const email = uniqueEmail('path-admin')
  await registerViaUi(page, email)
  await ensureAdministrationSession(context, email)
  await page.goto(admin(DEFAULT_LOCALE, '/login'))
  await expect(
    page.getByRole('heading', { name: baseCopy.organizationAccess.title, exact: true })
  ).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies.some((cookie) => cookie.name === 'amcore_session')).toBe(true)
  expect(cookies.some((cookie) => cookie.name === '__Host-amcore_staff_session')).toBe(separate)
  expect(
    (await logoutViaApi(context.request, origin, '/api/product-admin/auth/logout')).status()
  ).toBe(200)
  expect((await context.request.get(new URL('/api/auth/me', product).href)).status()).toBe(
    separate ? 200 : 401
  )
  await page.goto(`${admin(chosen, '/organizations')}?view=list`)
  await expect(
    page.getByRole('heading', { name: copy.productAdmin.loginTitle, exact: true })
  ).toBeVisible()
  await page.getByLabel(copy.auth.email, { exact: true }).fill(email)
  await page.getByLabel(copy.auth.password, { exact: true }).fill(TEST_PASSWORD)
  const signIn = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/auth/login') &&
      response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: copy.auth.login, exact: true }).click()
  const response = await signIn
  expect([200, 202]).toContain(response.status())
  if (response.status() === 202) await completeMfaSignIn(page, email)
  await expect(page).toHaveURL(`${admin(chosen, '/organizations')}?view=list`)
  await expect(
    page.getByRole('heading', { name: copy.organizationAccess.title, exact: true })
  ).toBeVisible()
  expect((await context.request.get(new URL('/api/auth/me', origin).href)).status()).toBe(200)
  const legacy = await context.request.get(
    `${localizedFrontendUrl(product, DEFAULT_LOCALE, '/organizations')}?view=list&unsafe=discard`,
    {
      maxRedirects: 0,
    }
  )
  expect(legacy.status()).toBe(308)
  expect(legacy.headers().location).toBe(`${admin(DEFAULT_LOCALE, '/organizations')}?view=list`)
  expect((await logoutViaApi(context.request, product)).status()).toBe(200)
  expect((await context.request.get(new URL('/api/auth/me', origin).href)).status()).toBe(
    separate ? 200 : 401
  )
  await page.goto(admin(DEFAULT_LOCALE, '/organizations'))
  await expect(
    page.getByRole('heading', {
      name: separate ? baseCopy.organizationAccess.title : baseCopy.productAdmin.loginTitle,
      exact: true,
    })
  ).toBeVisible()
})
