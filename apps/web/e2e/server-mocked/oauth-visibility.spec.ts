import { expect } from '@playwright/test'

import { test } from '../shared/auth-test'

/** Server fetches require real handler hits; the application's empty fallback is not mock proof. */
test.use({ oauthProvidersDefault: false })

test('shows the Google entry point when the backend reports it configured', async ({
  page,
  authMocks,
}) => {
  authMocks.providers(['google'])
  await page.goto('/en/login')
  await expect(page.getByRole('link', { name: /continue with google/i })).toBeVisible()
  expect(authMocks.hits.providers).toBeGreaterThan(0)
  expect(authMocks.hits.signup).toBeGreaterThan(0)
})

test('hides the Google entry point when no provider is configured', async ({ page, authMocks }) => {
  authMocks.providers([])
  await page.goto('/en/login')
  await expect(page.getByRole('link', { name: /continue with google/i })).toHaveCount(0)
  expect(authMocks.hits.providers).toBeGreaterThan(0)
  expect(authMocks.hits.signup).toBeGreaterThan(0)
})
