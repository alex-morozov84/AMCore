import { completeMfaSignIn } from '../shared/mfa-login'
import { consolePath, isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { setSystemRole } from './helpers'

test('host Audit uses the isolated console session and closes after demotion', async ({
  browser,
}) => {
  const email = uniqueEmail('console-audit')
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(
    (url) => url.origin === standTarget.origins.product && isProductHome(url)
  )
  setSystemRole(email, 'SUPER_ADMIN')

  const consoleContext = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const page = await consoleContext.newPage()
  await page.goto(productPath('/login'))
  await page.getByLabel(messages.console.loginEmail, { exact: true }).fill(email)
  await page.getByLabel(messages.console.loginPassword, { exact: true }).fill('Test1234Secure')
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: messages.console.signIn, exact: true }).click()
  await completeMfaSignIn(page, email)
  expect((await loginResponse).status()).toBe(202)
  await expect(page).toHaveURL(
    (url) => url.origin === standTarget.origins.console && isProductHome(url)
  )

  const browserTokens: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) browserTokens.push(request.url())
  })
  await page.getByRole('link', { name: messages.console.auditTitle, exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === productPath('/audit'))
  await expect(page.getByRole('heading', { name: messages.console.auditTitle })).toBeVisible()
  expect(browserTokens).toEqual([])
  expect(await page.content()).not.toContain('Bearer ')

  setSystemRole(email, 'USER')
  const response = await page.goto(productPath('/audit'))
  expect(response?.status()).toBe(404)
  const productResponse = await productPage.goto(consolePath('/audit'))
  expect(productResponse?.status()).toBe(404)

  await product.close()
  await consoleContext.close()
})
