import { expect, test } from '@playwright/test'

/**
 * `requireSession()` (`shared/api/bff/dal.ts`) is the real auth gate — not
 * `(dashboard)/layout.tsx`, which doesn't re-render on client-side
 * navigation between sibling protected routes. Each protected page must
 * gate independently; this exercises two of them against a real,
 * cookie-free session (no BFF vault entry to find), not a mock.
 */
test('an unauthenticated visitor is redirected to login from the dashboard root', async ({
  page,
}) => {
  await page.goto('/en')
  await expect(page).toHaveURL(/\/en\/login/)
})

test('an unauthenticated visitor is redirected to login from the sessions page', async ({
  page,
}) => {
  await page.goto('/en/settings/sessions')
  await expect(page).toHaveURL(/\/en\/login/)
})
