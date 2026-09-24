import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { setSystemRole } from './helpers'

test('host Audit uses the isolated console session and closes after demotion', async ({
  browser,
}) => {
  const email = uniqueEmail('console-audit')
  const product = await browser.newContext({
    baseURL: 'https://app.localhost',
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(/https:\/\/app\.localhost\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')

  const consoleContext = await browser.newContext({
    baseURL: 'https://console.localhost',
    ignoreHTTPSErrors: true,
  })
  const page = await consoleContext.newPage()
  await page.goto('/en/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill('Test1234Secure')
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /sign in/i }).click()
  expect((await loginResponse).status()).toBe(204)
  await expect(page).toHaveURL(/https:\/\/console\.localhost\/en\/?$/)

  const browserTokens: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) browserTokens.push(request.url())
  })
  await page.getByRole('link', { name: 'Audit', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/audit$/)
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
  expect(browserTokens).toEqual([])
  expect(await page.content()).not.toContain('Bearer ')

  setSystemRole(email, 'USER')
  const response = await page.goto('/en/audit')
  expect(response?.status()).toBe(404)
  const productResponse = await productPage.goto('/en/admin/audit')
  expect(productResponse?.status()).toBe(404)

  await product.close()
  await consoleContext.close()
})
