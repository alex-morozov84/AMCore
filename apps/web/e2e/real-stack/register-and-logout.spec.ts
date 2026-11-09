import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, signOutViaUi, uniqueEmail } from './helpers'

/**
 * Real registration and second login traverse the BFF, API and Redis session vault.
 *
 * Deliberately registers with no `name` — `registerSchema`'s `name` is
 * optional, and this is the end-to-end proof that omitting it really works
 * (the dashboard's generic "Welcome!" instead of "Welcome, {name}!" is the
 * observable signal that no name reached the backend).
 */
test('register creates an account, lands on the dashboard, logs out and authenticates the same account again', async ({
  page,
}) => {
  const email = uniqueEmail('register-logout')
  await registerViaUi(page, email)

  await expect(page).toHaveURL(/\/en\/?$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome!')

  await signOutViaUi(page)
  await expect(page).toHaveURL(/\/en\/login/)
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome!')
})
