import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from './helpers'

/**
 * The four email-link auth flows (Track 9 PR4): `forgot-password`,
 * `reset-password`, `verify-email`, `resend-verification`. No real mailbox
 * exists in any test infra here (the backend's `sendNow`/EQS-02 direct-send
 * path has no capture hook), so a genuine "click the real emailed link"
 * round trip isn't testable without new backend scaffolding — out of scope
 * for a frontend-consumer PR. What real-stack CAN prove without any email:
 * the enumeration-safe success response for both an existing and a
 * non-existing account (a real backend call either way), and the
 * missing/invalid-token states, which are exactly what a mistyped or stale
 * link produces.
 */

test('login page links to forgot-password', async ({ page }) => {
  await page.goto('/en/login')
  await page.getByRole('link', { name: /forgot your password/i }).click()
  await expect(page).toHaveURL(/\/en\/forgot-password/)
})

test('forgot-password shows the same success message for an existing account', async ({ page }) => {
  const email = uniqueEmail('forgot-password-existing')
  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/forgot-password')
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByRole('button', { name: /send reset link/i }).click()

  await expect(page.getByText(/we've sent a link to reset your password/i)).toBeVisible()
})

test('forgot-password shows the same success message for a non-existing email', async ({
  page,
}) => {
  await page.goto('/en/forgot-password')
  await page.getByRole('textbox', { name: /email/i }).fill(uniqueEmail('never-registered'))
  await page.getByRole('button', { name: /send reset link/i }).click()

  await expect(page.getByText(/we've sent a link to reset your password/i)).toBeVisible()
})

test('resend-verification shows the same success message regardless of account state', async ({
  page,
}) => {
  await page.goto('/en/resend-verification')
  await page.getByRole('textbox', { name: /email/i }).fill(uniqueEmail('never-registered'))
  await page.getByRole('button', { name: /resend verification email/i }).click()

  await expect(page.getByText(/we've sent a new verification link/i)).toBeVisible()
})

test('reset-password with no token shows the invalid-link state', async ({ page }) => {
  await page.goto('/en/reset-password')

  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
  await page.getByRole('link', { name: /request a new link/i }).click()
  await expect(page).toHaveURL(/\/en\/forgot-password/)
})

test('reset-password with a well-formed but unknown token gets a real 401 from the backend', async ({
  page,
}) => {
  await page.goto(`/en/reset-password?token=${'a'.repeat(64)}`)

  await page.getByLabel(/new password/i).fill('NewPassword1')
  await page.getByRole('button', { name: /reset password/i }).click()

  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
})

test('verify-email with no token shows the invalid-link state', async ({ page }) => {
  await page.goto('/en/verify-email')

  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
  await page.getByRole('link', { name: /resend verification/i }).click()
  await expect(page).toHaveURL(/\/en\/resend-verification/)
})

test('verify-email with a well-formed but unknown token gets a real 401 from the backend', async ({
  page,
}) => {
  await page.goto(`/en/verify-email?token=${'a'.repeat(64)}`)

  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
  await expect(page.getByRole('link', { name: /resend verification/i })).toBeVisible()
})
