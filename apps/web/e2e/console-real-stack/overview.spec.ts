import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { expectNoAxeViolations } from '../shared/axe'
import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget } from '../support/managed-target.mjs'

import { setSystemRole } from './helpers'

const standTarget = activeTarget()
// Texts come from the active catalogue, so the spec follows the project's locale choice.
const t = JSON.parse(
  readFileSync(join(standTarget.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
).console

test('role setup refuses an account whose registration has not completed', () => {
  expect(() => setSystemRole(uniqueEmail('console-unregistered'), 'SUPER_ADMIN')).toThrow(
    'Expected exactly one registered user for role setup; got UPDATE 0'
  )
})

test('host-mode Overview panel renders real readiness, version and process role, with no token exposed to the browser', async ({
  browser,
}) => {
  const email = uniqueEmail('console-overview')
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
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
  await completeMfaSignIn(consolePage, email)
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/?$')
  )

  const requestsWithAuthHeader: string[] = []
  consolePage.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  // A fresh docker-compose stack is healthy — assert the ready state, not
  // the not-ready one, and confirm it never says the console is unhealthy.
  await expect(consolePage.getByText(t.overviewNotReadyTitle)).not.toBeVisible()
  await expect(
    consolePage.getByText(t.overviewDependencyLabelDatabase, { exact: true })
  ).toBeVisible()
  await expect(consolePage.getByText(t.overviewDependencyLabelRedis)).toBeVisible()
  await expect(consolePage.getByText(t.overviewReadyTitle, { exact: true })).toBeVisible()
  await expect(consolePage.getByText(t.overviewFilesHealthy, { exact: true })).toBeVisible()
  // The stand uses the local driver, so the public-files row is off and says why.
  for (const name of [t.overviewPrivateFilesTitle, t.overviewPublicFilesTitle]) {
    await expect(consolePage.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await expect(consolePage.getByText(t.overviewPublicOff, { exact: true })).toBeVisible()
  await expect(consolePage.getByText(t.overviewPublicOffLocal, { exact: true })).toBeVisible()
  await consolePage.getByText(t.overviewTechnicalDetails, { exact: true }).click()
  await expect(consolePage.getByText(t.overviewVersionLabel)).toBeVisible()
  await expect(consolePage.getByText(t.overviewProcessRoleLabel)).not.toBeVisible()

  for (const name of [
    t.overviewWebTitle,
    t.overviewPoolTitle,
    t.overviewMemoryTitle,
    t.overviewDiskTitle,
  ]) {
    await expect(consolePage.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await expect(
    consolePage.getByRole('heading', { name: t.problems.title, exact: true })
  ).toBeVisible()
  const observed = consolePage.locator('#overview-api-checks time').first()
  const before = await observed.getAttribute('datetime')
  await consolePage.getByRole('button', { name: t.overviewRefresh, exact: true }).click()
  await expect(observed).not.toHaveAttribute('datetime', before!)

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
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
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
  await completeMfaSignIn(consolePage, email)
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/?$')
  )

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
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.product) + '/en/?$')
  )
  setSystemRole(email, 'SUPER_ADMIN')

  const console = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  const profileRequests: string[] = []
  consolePage.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/me') profileRequests.push(request.method())
  })
  await consolePage.goto('/en/login')
  await consolePage.getByLabel(/email/i).fill(email)
  await consolePage.getByLabel(/^password$/i).fill('Test1234Secure')
  await consolePage.getByRole('button', { name: /sign in/i }).click()
  await completeMfaSignIn(consolePage, email)
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/?$')
  )

  await expectNoAxeViolations(consolePage)
  expect(profileRequests).toEqual([])
  await consolePage.getByRole('combobox', { name: /language/i }).selectOption('ru')
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/ru/?$')
  )
  await expect(consolePage.getByRole('heading', { name: 'Операционная консоль' })).toBeVisible()
  await expectNoAxeViolations(consolePage)
  expect(profileRequests).toEqual([])

  await product.close()
  await console.close()
})

function escapeOrigin(origin: string): string {
  return origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
