import { activeTarget } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { setSystemRole } from './helpers'

test('host-mode Users inventory uses only the isolated console session', async ({ browser }) => {
  const email = uniqueEmail('console-users')
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email, { name: 'Console Inventory User' })
  await expect(productPage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.product) + '/en/?$')
  )
  setSystemRole(email, 'SUPER_ADMIN')

  const console = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  await consolePage.goto('/en/login')
  await consolePage.getByLabel(/email/i).fill(email)
  await consolePage.getByLabel(/^password$/i).fill('Test1234Secure')
  await consolePage.getByRole('button', { name: /sign in/i }).click()
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/?$')
  )

  const requestsWithAuthHeader: string[] = []
  consolePage.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })
  await consolePage.getByRole('link', { name: /users/i }).click()

  await expect(consolePage).toHaveURL(/\/en\/users$/)
  await expect(consolePage.getByText(email)).toBeVisible()
  expect(await consolePage.content()).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)
  await product.close()
  await console.close()
})

function escapeOrigin(origin: string): string {
  return origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
