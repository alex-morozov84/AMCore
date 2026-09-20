import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { createOrganization, setSystemRole } from './helpers'

test('host-mode Organizations panel renders real data via the console session, with no token exposed to the browser', async ({
  browser,
}) => {
  const email = uniqueEmail('console-orgs')
  const product = await browser.newContext({
    baseURL: 'https://app.localhost',
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(/https:\/\/app\.localhost\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')

  const orgName = `E2E Org ${Date.now()}`
  const orgSlug = `e2e-org-${Date.now()}`
  createOrganization(orgName, orgSlug)

  const console = await browser.newContext({
    baseURL: 'https://console.localhost',
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  await consolePage.goto('/en/login')
  await consolePage.getByLabel(/email/i).fill(email)
  await consolePage.getByLabel(/password/i).fill('Test1234Secure')
  await consolePage.getByRole('button', { name: /sign in/i }).click()
  await expect(consolePage).toHaveURL(/https:\/\/console\.localhost\/en\/?$/)

  const requestsWithAuthHeader: string[] = []
  consolePage.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  await consolePage.getByRole('link', { name: /organizations/i }).click()
  await expect(consolePage).toHaveURL(/\/en\/organizations$/)
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
    baseURL: 'https://app.localhost',
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  setSystemRole(email, 'SUPER_ADMIN')

  const console = await browser.newContext({
    baseURL: 'https://console.localhost',
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  await consolePage.goto('/en/login')
  await consolePage.getByLabel(/email/i).fill(email)
  await consolePage.getByLabel(/password/i).fill('Test1234Secure')
  await consolePage.getByRole('button', { name: /sign in/i }).click()
  await expect(consolePage).toHaveURL(/https:\/\/console\.localhost\/en\/?$/)

  setSystemRole(email, 'USER')
  const response = await consolePage.goto('/en/organizations')
  expect(response?.status()).toBe(404)

  await product.close()
  await console.close()
})
