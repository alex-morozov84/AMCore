import { expect, test } from '@playwright/test'

import { isProductHome, messages, productPath } from '../shared/product-settings'

import { registerViaUi, uniqueEmail } from './helpers'

/**
 * The four email-link auth flows (Track 9 PR4): `forgot-password`,
 * `reset-password`, `verify-email`, `resend-verification`. This ordinary lane
 * has no mailbox capture. The separate organization-setup fixture proves an
 * actual rendered recovery-link round trip through its internal collector.
 * These tests prove without reading any email:
 * the enumeration-safe success response for both an existing and a
 * non-existing account (a real backend call either way), and the
 * well-formed unknown-token refusals. Missing-token page/query/link branches
 * run in the mocked login-validation suite; they do not require this stack.
 */

test('forgot-password shows the same success message for an existing account', async ({ page }) => {
  const email = uniqueEmail('forgot-password-existing')
  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(isProductHome)

  await page.goto(productPath('/forgot-password'))
  await page.getByRole('textbox', { name: messages.auth.email, exact: true }).fill(email)
  await page.getByRole('button', { name: messages.auth.sendResetLink, exact: true }).click()

  await expect(page.getByText(messages.auth.forgotPasswordSuccess, { exact: true })).toBeVisible()
})

test('forgot-password shows the same success message for a non-existing email', async ({
  page,
}) => {
  await page.goto(productPath('/forgot-password'))
  await page
    .getByRole('textbox', { name: messages.auth.email, exact: true })
    .fill(uniqueEmail('never-registered'))
  await page.getByRole('button', { name: messages.auth.sendResetLink, exact: true }).click()

  await expect(page.getByText(messages.auth.forgotPasswordSuccess, { exact: true })).toBeVisible()
})

test('resend-verification shows success for a non-existing email', async ({ page }) => {
  await page.goto(productPath('/resend-verification'))
  await page
    .getByRole('textbox', { name: messages.auth.email, exact: true })
    .fill(uniqueEmail('never-registered'))
  await page.getByRole('button', { name: messages.auth.resendVerification, exact: true }).click()

  await expect(
    page.getByText(messages.auth.resendVerificationSuccess, { exact: true })
  ).toBeVisible()
})

test('reset-password with a well-formed but unknown token gets a real 401 from the backend', async ({
  page,
}) => {
  await page.goto(productPath(`/reset-password?token=${'a'.repeat(64)}`))

  await page.getByLabel(messages.auth.newPassword, { exact: true }).fill('NewPassword1')
  await page.getByRole('button', { name: messages.auth.resetPasswordSubmit, exact: true }).click()

  await expect(page.getByText(messages.errors.TOKEN_INVALID, { exact: true })).toBeVisible()
})

test('verify-email with a well-formed but unknown token gets a real 401 from the backend', async ({
  page,
}) => {
  await page.goto(productPath(`/verify-email?token=${'a'.repeat(64)}`))

  await expect(page.getByText(messages.errors.TOKEN_INVALID, { exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: messages.auth.resendVerification, exact: true })
  ).toBeVisible()
})
