import { expect } from '@playwright/test'

import { test } from '../shared/auth-test'
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
  await page.getByLabel(/^password$/i).fill('correct-horse-battery')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.locator('[data-slot="alert"]').waitFor()

  await expectNoAxeViolations(page)
})

test('register page has no axe violations', async ({ page }) => {
  await page.goto('/en/register')
  await expectNoAxeViolations(page)
})

test('reset password form has no axe violations', async ({ page }) => {
  await page.goto(`/en/reset-password?token=${'a'.repeat(64)}`)
  await expectNoAxeViolations(page)
})

const createdAccount = {
  statusCode: 503,
  message: 'Registration completed; sign-in is temporarily unavailable',
  errorCode: 'REGISTRATION_SIGN_IN_REQUIRED',
  timestamp: '2026-01-01T00:00:00.000Z',
  path: '/api/auth/register',
  method: 'POST',
  correlationId: 'test-correlation-id',
}

for (const { locale, name, size } of [
  { locale: 'en', name: 'Name', size: { width: 1280, height: 800 } },
  { locale: 'ru', name: 'Имя', size: { width: 360, height: 780 } },
] as const) {
  test(`register page keeps one focused notice and has no axe violations after a created account (${locale}, ${size.width}px)`, async ({
    page,
  }) => {
    let submissions = 0
    await page.route('**/api/auth/register', (route) => {
      submissions += 1
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify(createdAccount),
      })
    })
    await page.setViewportSize(size)
    await page.goto(`/${locale}/register`)
    await page.getByLabel(name, { exact: true }).fill('Jane Doe')
    await page.getByRole('textbox', { name: /email/i }).fill('jane@example.com')
    await page.locator('input[name="password"]').fill('Correct1Horse')
    await page.locator('form button[type="submit"]').click()

    // Scoped to our own `data-slot="alert"`: Next's route announcer is also a `role="alert"`.
    const notice = page.locator('[data-slot="alert"]')
    await expect(notice).toHaveCount(1)
    await expect(notice).toHaveAttribute('role', 'status')
    await expect(notice).toBeFocused()
    await expect(page.locator('input[name="password"]')).toBeDisabled()
    await expect(page.locator('input[name="password"]')).toHaveValue('')
    await expect(page.locator('form button[type="submit"]')).toHaveCount(0)
    await expect(page.locator('form a[href$="/login"]')).toHaveCount(1)
    expect(submissions).toBe(1)

    await expectNoAxeViolations(page)
  })
}
