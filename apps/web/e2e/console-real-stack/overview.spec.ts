import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { setSystemRole } from './helpers'

test('host-mode Overview panel renders real readiness, version and process role, with no token exposed to the browser', async ({
  browser,
}) => {
  const email = uniqueEmail('console-overview')
  const product = await browser.newContext({
    baseURL: 'https://app.localhost',
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(/https:\/\/app\.localhost\/en\/?$/)
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

  const requestsWithAuthHeader: string[] = []
  consolePage.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  // A fresh docker-compose stack is healthy — assert the ready state, not
  // the not-ready one, and confirm it never says the console is unhealthy.
  await expect(consolePage.getByText('API instance not ready')).not.toBeVisible()
  await expect(consolePage.getByText('Database')).toBeVisible()
  await expect(consolePage.getByText('Cache (Redis)')).toBeVisible()
  await expect(consolePage.getByText('API version')).toBeVisible()
  await expect(consolePage.getByText('Process role')).toBeVisible()

  const html = await consolePage.content()
  expect(html).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)

  await product.close()
  await console.close()
})

test('host-mode Overview panel denies a demoted session with a live re-check, not a cached admission', async ({
  browser,
}) => {
  const email = uniqueEmail('console-overview-denied')
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
  const response = await consolePage.goto('/en')
  expect(response?.status()).toBe(404)

  await product.close()
  await console.close()
})

test('host-mode Overview locale switcher stays on the console host and switches the rendered language', async ({
  browser,
}) => {
  const email = uniqueEmail('console-overview-locale')
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

  await consolePage.getByRole('combobox', { name: /language/i }).selectOption('ru')
  await expect(consolePage).toHaveURL(/https:\/\/console\.localhost\/ru\/?$/)
  await expect(consolePage.getByRole('heading', { name: 'Операционная консоль' })).toBeVisible()

  await product.close()
  await console.close()
})
