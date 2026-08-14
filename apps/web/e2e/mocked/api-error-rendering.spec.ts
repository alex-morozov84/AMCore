import { expect, test } from '@playwright/test'

/**
 * A real POST to `/api/auth/login` intercepted browser-side — proves the
 * localized-by-`errorCode` fallback (`ApiErrorAlert`/`UNKNOWN_ERROR`, see
 * `docs/frontend/i18n-and-errors.md`) actually renders when the BFF returns
 * a shape the client can't translate to a specific code, not just that the
 * component compiles.
 */

test('an unrecognized API failure renders the localized fallback message', async ({ page }) => {
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

  // Scoped to `data-slot="alert"` (`shared/ui/alert.tsx`) — a plain
  // `getByRole('alert')` also matches Next's own `role="alert"`
  // route-announcer live region, which isn't the element under test.
  const alert = page.locator('[data-slot="alert"]')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('Something went wrong')
})
