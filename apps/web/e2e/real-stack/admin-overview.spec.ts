import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

/**
 * Path mode reuses the ordinary product session for the console (no
 * separate console login) - mirrors `console-real-stack/overview.spec.ts`'s
 * host-mode coverage of the same panel. See that file's `SystemRolesGuard`
 * note on why SUPER_ADMIN tests must re-authenticate after promotion.
 */
test('path-mode Overview panel renders real readiness, version and process role via the reused product session', async ({
  page,
}) => {
  const email = uniqueEmail('admin-overview')
  await registerViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  const requestsWithAuthHeader: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  await page.goto('/en/admin')
  // A fresh docker-compose stack is healthy - assert the ready state, not
  // the not-ready one, and confirm it never says the console is unhealthy.
  await expect(page.getByText('API instance not ready')).not.toBeVisible()
  await expect(page.getByText('Database', { exact: true })).toBeVisible()
  await expect(page.getByText('Cache (Redis)')).toBeVisible()
  await expect(page.getByText('API is ready', { exact: true })).toBeVisible()
  await expect(page.getByText('Working', { exact: true })).toBeVisible()
  await page.getByText('Build details', { exact: true }).click()
  await expect(page.getByText('API version')).toBeVisible()
  await expect(page.getByText('Process role')).not.toBeVisible()

  for (const name of [
    'Responding web server build',
    'Database connections',
    'JavaScript memory',
    'API disk space',
  ]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  const observed = page.locator('header time').last()
  const before = await observed.getAttribute('datetime')
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true })
  await refresh.focus()
  await expect(refresh).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(observed).not.toHaveAttribute('datetime', before!)
  await expect(refresh).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'API disk space', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)

  const html = await page.content()
  expect(html).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)
})

test('path-mode Overview panel denies a demoted session with a live re-check', async ({ page }) => {
  const email = uniqueEmail('admin-overview-denied')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/admin')
  await expect(page.getByRole('heading', { name: 'Operations Console' })).toBeVisible()

  setSystemRole(email, 'USER')
  const response = await page.goto('/en/admin')
  expect(response?.status()).toBe(404)
})

test('path-mode console locale switcher preserves the current page and its query parameters', async ({
  page,
}) => {
  const email = uniqueEmail('admin-overview-locale')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/admin/organizations?page=2')
  await page.getByRole('combobox', { name: /language/i }).click()
  await page.getByRole('option', { name: 'Русский' }).click()

  await expect(page).toHaveURL(/\/ru\/admin\/organizations\?page=2$/)
  await expect(page.getByRole('heading', { name: 'Организации' })).toBeVisible()
})
