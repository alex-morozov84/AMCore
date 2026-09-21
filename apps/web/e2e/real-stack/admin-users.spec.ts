import { expect, type Page, test } from '@playwright/test'

import { createUsersForPagination, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

async function signInAsPathAdmin(page: Page, email: string) {
  await registerViaUi(page, email, { name: 'Path Inventory User' })
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
}

test('path-mode Users inventory renders real user data without exposing a token', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users')
  await signInAsPathAdmin(page, email)
  const requestsWithAuthHeader: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  await page.goto('/en/admin/users')

  await expect(page.getByRole('heading', { name: /users/i })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: email }).getByRole('cell', { name: 'Super admin' })
  ).toBeVisible()
  expect(await page.content()).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)
})

test('path-mode client navigation removes console chrome after a live denial', async ({ page }) => {
  const email = uniqueEmail('admin-users-denied')
  await signInAsPathAdmin(page, email)
  await page.goto('/en/admin/users')
  await expect(page.getByRole('heading', { name: /users/i })).toBeVisible()

  await page.getByRole('link', { name: /overview/i }).click()
  await expect(page).toHaveURL(/\/en\/admin\/?$/)
  setSystemRole(email, 'USER')

  await page.getByRole('link', { name: /users/i }).click()
  await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /users/i })).toHaveCount(0)
  await expect(page.locator('[data-console-shell="title"]')).toHaveCount(0)
  await expect(page.getByText('Path Inventory User')).toHaveCount(0)
})

test('path-mode client navigation retains the collapsed sidebar preference', async ({ page }) => {
  const email = uniqueEmail('admin-users-sidebar')
  await signInAsPathAdmin(page, email)
  await page.goto('/en/admin/users')

  const sidebar = page.locator('[data-slot="sidebar"]').first()
  await page
    .getByRole('button', { name: /toggle.*navigation/i })
    .first()
    .click()
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')

  await page.getByRole('link', { name: /overview/i }).click()
  await expect(page).toHaveURL(/\/en\/admin\/?$/)
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute(
    'data-state',
    'collapsed'
  )
})

test('path-mode Users inventory paginates with progress-aware Next and Previous links', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users-page2')
  await signInAsPathAdmin(page, email)
  const markerEmail = uniqueEmail('users-page2-marker')
  createUsersForPagination(markerEmail, `users-page2-filler-${Date.now()}`)

  await page.goto('/en/admin/users')
  await expect(page.getByText(markerEmail)).toHaveCount(0)

  await page.getByRole('link', { name: /next/i }).click()
  await expect(page).toHaveURL(/[?&]page=2\b/)
  await expect(page.getByText(markerEmail)).toBeVisible()

  await page.getByRole('link', { name: /previous/i }).click()
  await expect(page).toHaveURL(/[?&]page=1\b/)
  await expect(page.getByText(markerEmail)).toHaveCount(0)
})
