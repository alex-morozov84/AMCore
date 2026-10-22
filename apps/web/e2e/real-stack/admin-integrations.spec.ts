import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { ageSessionLastAuthAt, setEmailVerified, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

const ROWS = ['Email', 'Files', 'Sign-in providers', 'Queue', 'AI', 'Telegram']

async function signInAsOperator(page: Page, prefix: string, verified = true) {
  const email = uniqueEmail(prefix)
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  if (verified) setEmailVerified(email)
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
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
  await page.goto('/en/admin')
  await page.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/admin\/integrations$/)
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()

  const table = page.getByRole('table', { name: 'Integrations' })
  for (const name of ROWS) await expect(table.getByText(name, { exact: true })).toBeVisible()
  const email = table.getByRole('row').filter({ hasText: 'Email' })
  await expect(email).toContainText('Set up, not verified')
  await expect(email).toContainText('No stored result')
  await expect(table.getByRole('row').filter({ hasText: 'Sign-in providers' })).toContainText(
    'Configuration only'
  )

  const observed = page.locator('time').first()
  const before = await observed.getAttribute('datetime')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
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
  await page.goto('/en/admin/integrations')
  await page.getByRole('button', { name: 'Send test email' }).click()
  await expect(page.getByText('Send a test email?')).toBeVisible()
  await expect(page.getByText(/\*\*\*@/)).toBeVisible()
  await page.getByRole('button', { name: 'Send test' }).click()

  // The session is old, so the Console asks for the password once and retries the same attempt.
  await expect(page.getByText('Confirm your password')).toBeVisible()
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Confirm' }).click()

  await expect(page.getByText(/Simulated\. The mock provider is in use/)).toBeVisible()
  expect(prepares).toHaveLength(1)
  // The first POST was refused for the missing password check, the retry carried the same id.
  expect(probes.length).toBeGreaterThanOrEqual(2)
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Close' }).click()

  const row = page.getByRole('table', { name: 'Integrations' }).getByRole('row').filter({
    hasText: 'Email',
  })
  await expect(row).toContainText('Simulated')
  await expect(page.getByRole('button', { name: 'Send test email' })).toBeDisabled()
  await expect(
    page.getByRole('table', { name: 'Integrations' }).getByText(/A test was started a moment ago/)
  ).toBeVisible()

  const before = probes.length
  await page.getByRole('button', { name: /Last test/ }).click()
  await expect(page.getByText(/Simulated\. The mock provider is in use/)).toBeVisible()
  expect(probes).toHaveLength(before)
  expect(prepares).toHaveLength(1)
})

test('path-mode Integrations disables the test without a verified address and says why', async ({
  page,
}) => {
  await signInAsOperator(page, 'admin-integrations-unverified', false)
  await page.goto('/en/admin/integrations')
  await expect(page.getByRole('button', { name: 'Send test email' })).toBeDisabled()
  await expect(
    page
      .getByRole('table', { name: 'Integrations' })
      .getByText('Your account has no verified email address.')
  ).toBeVisible()
})

test('path-mode Integrations is available in Russian, readable on a narrow screen and denies a demoted session', async ({
  page,
}) => {
  const email = await signInAsOperator(page, 'admin-integrations-ru')
  await page.goto('/ru/admin/integrations')
  await expect(page.getByRole('heading', { name: 'Интеграции', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('table', { name: 'Интеграции' }).getByText('Почта', { exact: true })
  ).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('table', { name: 'Интеграции' })).toBeHidden()
  await expect(page.getByRole('list', { name: 'Интеграции' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)

  setSystemRole(email, 'USER')
  const response = await page.goto('/en/admin/integrations')
  expect(response?.status()).toBe(404)
})
