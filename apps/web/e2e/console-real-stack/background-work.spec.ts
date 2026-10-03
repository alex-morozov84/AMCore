import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'
import {
  backgroundWorkDegradedJourney,
  backgroundWorkJourney,
  backgroundWorkRetryAfterJourney,
} from '../shared/background-work-journey'
import { activeTarget } from '../support/managed-target.mjs'

import { setSystemRole } from './helpers'

/** Host topology: the Console has its own origin, session audience and login. */
async function operator(
  browser: Parameters<Parameters<typeof test>[2]>[0]['browser'],
  label: string
) {
  const target = activeTarget()
  const email = uniqueEmail(label)
  const product = await browser.newContext({
    baseURL: target.origins.product,
    ignoreHTTPSErrors: true,
  })
  const consoleContext = await browser.newContext({
    baseURL: target.origins.console,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(/\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')
  const page = await consoleContext.newPage()
  await page.goto('/en/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill('Test1234Secure')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/en\/?$/)
  return { page, close: () => Promise.all([product.close(), consoleContext.close()]) }
}

test('host-mode Background work: snapshot, live refresh, containment, responsive and accessible', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const { page, close } = await operator(browser, 'console-background-work')
  try {
    await backgroundWorkJourney(page, '/en/background-work')
  } finally {
    await close()
  }
})

test('host-mode Background work: unreadable queues are data and back off', async ({ browser }) => {
  test.setTimeout(180_000)
  const { page, close } = await operator(browser, 'console-background-work-degraded')
  try {
    await backgroundWorkDegradedJourney(page, '/en/background-work')
  } finally {
    await close()
  }
})

test('host-mode Background work: a short Retry-After frees manual Refresh before the automatic backoff ends', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const { page, close } = await operator(browser, 'console-background-work-retry-after')
  try {
    await backgroundWorkRetryAfterJourney(page, '/en/background-work')
  } finally {
    await close()
  }
})

test('host-mode Background work: protected pages fail closed before the Console login', async ({
  browser,
}) => {
  const target = activeTarget()
  const context = await browser.newContext({
    baseURL: target.origins.console,
    ignoreHTTPSErrors: true,
  })
  try {
    const page = await context.newPage()
    expect((await page.goto('/en/background-work'))?.status()).toBe(404)
    await expect(page.getByRole('table', { name: 'Background queues' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
