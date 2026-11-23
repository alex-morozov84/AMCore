import { isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { expect, test } from '@playwright/test'

import { createLoginDiagnosticTarget } from '../real-stack/admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { setSystemRole } from './helpers'
import { inspectLoginDiagnostics } from './login-diagnostics'

test('host-mode Users inventory uses only the isolated console session', async ({ browser }) => {
  const email = uniqueEmail('console-users')
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email, { name: 'Console Inventory User' })
  await expect(productPage).toHaveURL(
    (url) => url.origin === standTarget.origins.product && isProductHome(url)
  )
  setSystemRole(email, 'SUPER_ADMIN')

  const console = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  await loginViaUi(consolePage, email, { mfa: 'required', surface: 'console' })
  await expect(consolePage).toHaveURL(
    (url) => url.origin === standTarget.origins.console && isProductHome(url)
  )

  const requestsWithAuthHeader: string[] = []
  consolePage.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })
  await consolePage.getByRole('link', { name: messages.console.users, exact: true }).click()

  await expect(consolePage).toHaveURL((url) => url.pathname === productPath('/users'))
  await expect(consolePage.getByText(email)).toBeVisible()
  expect(await consolePage.content()).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)
  const targetEmail = uniqueEmail('host-diagnostics-target')
  const target = createLoginDiagnosticTarget(targetEmail)
  await inspectLoginDiagnostics(consolePage, target.id, targetEmail, target.canary)
  await product.close()
  await console.close()
})
