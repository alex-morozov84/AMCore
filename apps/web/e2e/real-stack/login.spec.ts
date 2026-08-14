import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test('an existing account can log in and lands on the dashboard', async ({ page }) => {
  const email = uniqueEmail('login')

  // Setup: register, then sign out — so the assertion below exercises a
  // real second authentication against the account, not registration's own
  // auto-login.
  await registerViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  await page.getByRole('button', { name: /sign out/i }).click()
  await expect(page).toHaveURL(/\/en\/login/)

  await loginViaUi(page, email)

  await expect(page).toHaveURL(/\/en\/?$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome')
})
