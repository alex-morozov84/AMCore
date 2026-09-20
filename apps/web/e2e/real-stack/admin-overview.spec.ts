import { expect, test } from '@playwright/test'

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
  await expect(page.getByText('Database')).toBeVisible()
  await expect(page.getByText('Cache (Redis)')).toBeVisible()
  await expect(page.getByText('API version')).toBeVisible()
  await expect(page.getByText('Process role')).toBeVisible()

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
  await page.getByRole('combobox', { name: /language/i }).selectOption('ru')

  await expect(page).toHaveURL(/\/ru\/admin\/organizations\?page=2$/)
  await expect(page.getByRole('heading', { name: 'Организации' })).toBeVisible()
})
