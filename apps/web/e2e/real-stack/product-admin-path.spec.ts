import { expect, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

test('path administration shares website login/logout and preserves a localized protected destination', async ({
  page,
  context,
}) => {
  const { product } = activeTarget().origins
  const email = uniqueEmail('path-admin')
  await registerViaUi(page, email)
  await page.goto('/en/manage/login')
  await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies.some((cookie) => cookie.name === 'amcore_session')).toBe(true)
  expect(cookies.some((cookie) => cookie.name === '__Host-amcore_staff_session')).toBe(false)
  expect(
    (
      await context.request.post('/api/product-admin/auth/logout', { headers: { Origin: product } })
    ).status()
  ).toBe(200)
  expect((await context.request.get('/api/auth/me')).status()).toBe(401)
  await page.goto('/ru/manage/organizations?view=list')
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL(`${product}/ru/manage/organizations?view=list`)
  await expect(page.getByRole('heading', { name: 'Организации', exact: true })).toBeVisible()
  expect((await context.request.get('/api/auth/me')).status()).toBe(200)
  const legacy = await context.request.get('/en/organizations?view=list&unsafe=discard', {
    maxRedirects: 0,
  })
  expect(legacy.status()).toBe(308)
  expect(legacy.headers().location).toBe(`${product}/en/manage/organizations?view=list`)
  expect(
    (await context.request.post('/api/auth/logout', { headers: { Origin: product } })).status()
  ).toBe(200)
  await page.goto('/en/manage/organizations')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
})
