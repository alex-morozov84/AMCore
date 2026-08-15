import { test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

/**
 * Automated WCAG A/AA scans (Track 7 FINAL PLAN §5) on the public pages
 * reachable without real infra. Login/register cover both their default
 * state and, for login, an API-failure state — a scan taken only in the
 * happy path would miss the `ApiErrorAlert` banner entirely.
 */

test('login page has no axe violations', async ({ page }) => {
  await page.goto('/en/login')
  await expectNoAxeViolations(page)
})

test('login page has no axe violations in its API-error state', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'boom', correlationId: 'test-correlation-id' }),
    })
  )

  await page.goto('/en/login')
  await page.getByRole('textbox', { name: /email/i }).fill('spike-e2e@example.com')
  await page.getByLabel(/password/i).fill('correct-horse-battery')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.locator('[data-slot="alert"]').waitFor()

  await expectNoAxeViolations(page)
})

test('register page has no axe violations', async ({ page }) => {
  await page.goto('/en/register')
  await expectNoAxeViolations(page)
})
