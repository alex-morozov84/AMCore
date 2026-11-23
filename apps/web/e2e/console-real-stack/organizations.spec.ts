import { consolePath, isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { createOrganization, setSystemRole } from './helpers'

test('host-mode Organizations panel renders real data via the console session, with no token exposed to the browser', async ({
  browser,
}) => {
  const email = uniqueEmail('console-orgs')
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

  const orgName = `E2E Org ${Date.now()}`
  const orgSlug = `e2e-org-${Date.now()}`
  createOrganization(orgName, orgSlug)

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

  await consolePage.getByRole('link', { name: messages.console.organizations, exact: true }).click()
  await expect(consolePage).toHaveURL((url) => url.pathname === productPath('/organizations'))
  await expect(consolePage.getByRole('cell', { name: orgName })).toBeVisible()
  await expect(consolePage.getByRole('cell', { name: orgSlug })).toBeVisible()

  const html = await consolePage.content()
  expect(html).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)

  await product.close()
  await console.close()
})

test('host-mode Organizations panel denies a demoted session with a live re-check, not a cached admission', async ({
  browser,
}) => {
  const email = uniqueEmail('console-orgs-denied')
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

  const console = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  await loginViaUi(consolePage, email, { mfa: 'required', surface: 'console' })
  await expect(consolePage).toHaveURL(
    (url) => url.origin === standTarget.origins.console && isProductHome(url)
  )

  setSystemRole(email, 'USER')
  const response = await consolePage.goto(productPath('/organizations'))
  expect(response?.status()).toBe(404)

  await product.close()
  await console.close()
})

test('the admin route is denied on the product host even for a real SUPER_ADMIN session', async ({
  browser,
}) => {
  const email = uniqueEmail('console-orgs-wronghost')
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

  // `hasCanonicalConsoleHost()` (`shared/lib/console-host-guard.ts`) gates
  // `admin/layout.tsx` on the *incoming Host header*, independent of
  // `requireSuperAdmin()` - the physical path must 404 on the wrong host
  // even for a genuinely privileged product session.
  const response = await productPage.goto(consolePath('/organizations'))
  expect(response?.status()).toBe(404)

  await product.close()
})
