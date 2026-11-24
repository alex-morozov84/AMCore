import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, SERVED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { expectNoAxeViolations } from '../shared/axe'
import { isProductHome, messages, messagesForLocale, productPath } from '../shared/product-settings'
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

  // A fresh docker-compose stack is healthy — assert the ready state, not
  // the not-ready one, and confirm it never says the console is unhealthy.
  await expect(consolePage.getByText(t.overviewNotReadyTitle)).not.toBeVisible()
  await expect(
    consolePage.getByText(t.overviewDependencyLabelDatabase, { exact: true })
  ).toBeVisible()
  await expect(consolePage.getByText(t.overviewDependencyLabelRedis, { exact: true })).toBeVisible()
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
  const response = await consolePage.goto(productPath())
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
    (url) => url.origin === standTarget.origins.product && isProductHome(url)
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
  await loginViaUi(consolePage, email, { mfa: 'required', surface: 'console' })
  await expect(consolePage).toHaveURL(
    (url) => url.origin === standTarget.origins.console && isProductHome(url)
  )

  await expectNoAxeViolations(consolePage)
  expect(profileRequests).toEqual([])
  const second = SERVED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE)
  if (second) {
    await consolePage
      .getByRole('combobox', { name: messages.locale.label, exact: true })
      .selectOption(second)
    await expect(consolePage).toHaveURL(
      (url) => url.origin === standTarget.origins.console && isProductHome(url, second)
    )
    await expect(
      consolePage.getByRole('heading', { name: messagesForLocale(second).console.title })
    ).toBeVisible()
  } else {
    await expect(
      consolePage.getByRole('combobox', { name: messages.locale.label, exact: true })
    ).toHaveCount(0)
    await consolePage.reload()
    await expect(consolePage.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE)
    await expect(consolePage).toHaveURL(
      (url) => url.origin === standTarget.origins.console && isProductHome(url)
    )
  }
  await expectNoAxeViolations(consolePage)
  expect(profileRequests).toEqual([])

  await product.close()
  await console.close()
})
