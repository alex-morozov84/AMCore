import { SERVED_LOCALES } from '@amcore/shared'
import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { requirePathConsole } from '../shared/console-applicability'
import { completeMfaStepUp } from '../shared/mfa-login'
import { consolePath, isProductHome, messages, messagesForLocale } from '../shared/product-settings'

import { ageSessionLastAuthAt, setEmailVerified, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

requirePathConsole()

const ROWS = [
  messages.console.integrations.names.email,
  messages.console.integrations.names.storage,
  messages.console.integrations.names.oauth,
  messages.console.integrations.names.queue,
  messages.console.integrations.names.ai,
  messages.console.integrations.names.telegram,
]

async function signInAsOperator(page: Page, prefix: string, verified = true) {
  const email = uniqueEmail(prefix)
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  if (verified) setEmailVerified(email)
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
  return email
}

test('path-mode Integrations lists every registered service and never starts a check on its own', async ({
  page,
}) => {
  await signInAsOperator(page, 'admin-integrations')
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\/.*integrations/.test(request.url()))
      writes.push(request.url())
  })
  await page.goto(consolePath(''))
  await page
    .getByRole('link', { name: messages.console.integrations.tableLabel, exact: true })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === consolePath('/integrations'))
  await expect(
    page.getByRole('heading', { name: messages.console.integrations.tableLabel, level: 1 })
  ).toBeVisible()

  const table = page.getByRole('table', { name: messages.console.integrations.tableLabel })
  for (const name of ROWS) await expect(table.getByText(name, { exact: true })).toBeVisible()
  const email = table
    .getByRole('row')
    .filter({ hasText: messages.console.integrations.names.email })
  await expect(email).toContainText(messages.console.integrations.headline.setUpNotVerified)
  await expect(email).toContainText(messages.console.integrations.noStoredResult)
  await expect(
    table.getByRole('row').filter({ hasText: messages.console.integrations.names.oauth })
  ).toContainText(messages.console.integrations.scope.configuration_only)

  const observed = page.locator('time').first()
  const before = await observed.getAttribute('datetime')
  await page
    .getByRole('button', { name: messages.console.integrations.refresh, exact: true })
    .click()
  await expect(observed).not.toHaveAttribute('datetime', before!)
  expect(writes).toEqual([])
  await expectNoAxeViolations(page)
})

test('path-mode Integrations sends one test email after a recent password check and reopens it read-only', async ({
  page,
}) => {
  const email = await signInAsOperator(page, 'admin-integrations-test')
  ageSessionLastAuthAt(email)
  const probes: string[] = []
  const prepares: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (/\/integrations\/email\/probe\/prepare$/.test(request.url())) prepares.push(request.url())
    else if (/\/integrations\/email\/probe$/.test(request.url())) probes.push(request.url())
  })
  await page.goto(consolePath('/integrations'))
  await page
    .getByRole('button', { name: messages.console.integrations.probe.operator_email_test.button })
    .click()
  await expect(
    page.getByText(messages.console.integrations.probe.operator_email_test.confirmTitle)
  ).toBeVisible()
  await expect(page.getByText(/\*\*\*@/)).toBeVisible()
  await page
    .getByRole('button', {
      name: messages.console.integrations.probe.operator_email_test.confirmAction,
    })
    .click()

  // The session is old, so the Console asks for the password once and retries the same attempt.
  await expect(page.getByText(messages.console.stepUpTitle)).toBeVisible()
  await page.getByLabel(messages.console.loginPassword, { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: messages.console.stepUpSubmit }).click()

  await completeMfaStepUp(page, email)
  await expect(
    page.getByText(messages.console.integrations.probe.operator_email_test.outcome.simulated)
  ).toBeVisible()
  expect(prepares).toHaveLength(1)
  // The first POST was refused for the missing password check, the retry carried the same id.
  expect(probes.length).toBeGreaterThanOrEqual(2)
  await expectNoAxeViolations(page)
  await page
    .getByRole('button', { name: messages.console.organizationAdministration.close })
    .click()

  const row = page
    .getByRole('table', { name: messages.console.integrations.tableLabel })
    .getByRole('row')
    .filter({
      hasText: messages.console.integrations.names.email,
    })
  await expect(row).toContainText(messages.console.integrations.result.simulated)
  await expect(
    page.getByRole('button', {
      name: messages.console.integrations.probe.operator_email_test.button,
    })
  ).toBeDisabled()
  await expect(
    page
      .getByRole('table', { name: messages.console.integrations.tableLabel })
      .getByText(messages.console.integrations.probe.operator_email_test.unavailable.cooldown)
  ).toBeVisible()

  const before = probes.length
  await page
    .getByRole('button', { name: messages.console.integrations.probe.operator_email_test.lastTest })
    .click()
  await expect(
    page.getByText(messages.console.integrations.probe.operator_email_test.outcome.simulated)
  ).toBeVisible()
  expect(probes).toHaveLength(before)
  expect(prepares).toHaveLength(1)
})

test('path-mode Integrations disables the test without a verified address and says why', async ({
  page,
}) => {
  await signInAsOperator(page, 'admin-integrations-unverified', false)
  await page.goto(consolePath('/integrations'))
  await expect(
    page.getByRole('button', {
      name: messages.console.integrations.probe.operator_email_test.button,
    })
  ).toBeDisabled()
  await expect(
    page
      .getByRole('table', { name: messages.console.integrations.tableLabel })
      .getByText(
        messages.console.integrations.probe.operator_email_test.unavailable.no_verified_address
      )
  ).toBeVisible()
})

test('path-mode Integrations is available in Russian, readable on a narrow screen and denies a demoted session', async ({
  page,
}) => {
  const email = await signInAsOperator(page, 'admin-integrations-ru')
  const reviewLocale = SERVED_LOCALES.at(-1)!
  const reviewMessages = messagesForLocale(reviewLocale)
  await page.goto(consolePath('/integrations', reviewLocale))
  await expect(
    page.getByRole('heading', { name: reviewMessages.console.integrations.title, level: 1 })
  ).toBeVisible()
  await expect(
    page
      .getByRole('table', { name: reviewMessages.console.integrations.title })
      .getByText(reviewMessages.console.integrations.names.email, { exact: true })
  ).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('table', { name: reviewMessages.console.integrations.title })
  ).toBeHidden()
  await expect(
    page.getByRole('list', { name: reviewMessages.console.integrations.title })
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)

  setSystemRole(email, 'USER')
  const response = await page.goto(consolePath('/integrations'))
  expect(response?.status()).toBe(404)
})
