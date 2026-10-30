import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_LOCALE,
  localizedFrontendUrl,
  productAdminPath,
  SUPPORTED_LOCALES,
} from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { logoutViaApi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

test('path administration shares website login/logout and preserves a localized protected destination', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  const { product } = target.origins
  const chosen = SUPPORTED_LOCALES.find((locale: string) => locale === 'ru') ?? DEFAULT_LOCALE
  const catalogue = (locale: string) =>
    JSON.parse(readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8'))
  const baseCopy = catalogue(DEFAULT_LOCALE)
  const copy = catalogue(chosen)
  const admin = (locale: typeof DEFAULT_LOCALE, suffix: string) =>
    localizedFrontendUrl(product, locale, productAdminPath(suffix))
  const email = uniqueEmail('path-admin')
  await registerViaUi(page, email)
  await page.goto(admin(DEFAULT_LOCALE, '/login'))
  await expect(
    page.getByRole('heading', { name: baseCopy.organizationAccess.title, exact: true })
  ).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies.some((cookie) => cookie.name === 'amcore_session')).toBe(true)
  expect(cookies.some((cookie) => cookie.name === '__Host-amcore_staff_session')).toBe(false)
  expect(
    (await logoutViaApi(context.request, product, '/api/product-admin/auth/logout')).status()
  ).toBe(200)
  expect((await context.request.get('/api/auth/me')).status()).toBe(401)
  await page.goto(`${admin(chosen, '/organizations')}?view=list`)
  await expect(
    page.getByRole('heading', { name: copy.productAdmin.loginTitle, exact: true })
  ).toBeVisible()
  await page.getByLabel(copy.auth.email, { exact: true }).fill(email)
  await page.getByLabel(copy.auth.password, { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: copy.auth.login, exact: true }).click()
  await expect(page).toHaveURL(`${admin(chosen, '/organizations')}?view=list`)
  await expect(
    page.getByRole('heading', { name: copy.organizationAccess.title, exact: true })
  ).toBeVisible()
  expect((await context.request.get('/api/auth/me')).status()).toBe(200)
  const legacy = await context.request.get(
    `${localizedFrontendUrl(product, DEFAULT_LOCALE, '/organizations')}?view=list&unsafe=discard`,
    {
      maxRedirects: 0,
    }
  )
  expect(legacy.status()).toBe(308)
  expect(legacy.headers().location).toBe(`${admin(DEFAULT_LOCALE, '/organizations')}?view=list`)
  expect((await logoutViaApi(context.request, product)).status()).toBe(200)
  await page.goto(admin(DEFAULT_LOCALE, '/organizations'))
  await expect(
    page.getByRole('heading', { name: baseCopy.productAdmin.loginTitle, exact: true })
  ).toBeVisible()
})
