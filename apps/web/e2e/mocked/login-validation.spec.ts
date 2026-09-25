import { expect, type Page, test } from '@playwright/test'

const passwordHints = {
  en: 'Use at least 8 characters, including one uppercase Latin letter (A–Z) and one digit (0–9).',
  ru: 'Используйте не менее 8 символов, включая одну заглавную латинскую букву (A–Z) и одну цифру (0–9).',
}

async function expectPasswordHint(page: Page, locale: 'en' | 'ru') {
  const input = page.locator('input[type="password"]')
  const hint = page.getByText(passwordHints[locale], { exact: true })
  await expect(hint).toBeVisible()
  const hintId = await hint.getAttribute('id')
  if (!hintId) throw new Error('Password hint has no ID')
  await expect(input).toHaveAttribute('aria-describedby', hintId)
  return input
}

async function expectHintAndErrorDescription(page: Page) {
  const input = page.locator('input[type="password"]')
  const hint = page.locator('[data-slot="form-description"]')
  const error = page.locator('[data-slot="form-message"]')
  await expect(error).toBeVisible()
  const hintId = await hint.getAttribute('id')
  const errorId = await error.getAttribute('id')
  if (!hintId || !errorId) throw new Error('Password description or error has no ID')
  await expect(input).toHaveAttribute('aria-describedby', `${hintId} ${errorId}`)
}

/**
 * Client-side Zod validation (`useLocalizedForm()`) must reject an obviously
 * invalid submission before any request reaches the BFF — asserted
 * structurally (`aria-invalid`, no network call), not against the exact
 * translated copy, so this spec doesn't need updating every time a message
 * changes wording or a locale is added.
 */

test('login form rejects an invalid submission without calling the BFF', async ({ page }) => {
  let loginRequestSeen = false
  await page.route('**/api/auth/login', (route) => {
    loginRequestSeen = true
    return route.abort()
  })

  await page.goto('/en/login')

  await page.getByRole('textbox', { name: /email/i }).fill('not-an-email')
  // Password left empty — required field.
  await page.getByRole('button', { name: /sign in/i }).click()

  await expect(page.getByRole('textbox', { name: /email/i })).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(loginRequestSeen).toBe(false)
})

test('register form rejects a weak password without calling the BFF', async ({ page }) => {
  let registerRequestSeen = false
  await page.route('**/api/auth/register', (route) => {
    registerRequestSeen = true
    return route.abort()
  })

  await page.goto('/en/register')

  const input = await expectPasswordHint(page, 'en')

  await page.getByRole('textbox', { name: /email/i }).fill('spike-e2e@example.com')
  // `registerSchema` requires min 8 chars + an uppercase + a digit.
  await input.fill('weak')
  await page.getByRole('button', { name: /sign up/i }).click()

  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expectHintAndErrorDescription(page)
  expect(registerRequestSeen).toBe(false)
})

test('registration hint is localized in Russian', async ({ page }) => {
  await page.goto('/ru/register')
  await expectPasswordHint(page, 'ru')
})

test('reset form explains the password rule and rejects a weak password locally', async ({
  page,
}) => {
  let resetRequestSeen = false
  await page.route('**/api/auth/reset-password', (route) => {
    resetRequestSeen = true
    return route.abort()
  })

  await page.goto(`/en/reset-password?token=${'a'.repeat(64)}`)
  const input = await expectPasswordHint(page, 'en')
  await input.fill('weak')
  await page.getByRole('button', { name: /reset password/i }).click()

  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expectHintAndErrorDescription(page)
  expect(resetRequestSeen).toBe(false)
})

test('reset hint is localized in Russian and absent without a token', async ({ page }) => {
  await page.goto(`/ru/reset-password?token=${'a'.repeat(64)}`)
  await expectPasswordHint(page, 'ru')

  await page.goto('/ru/reset-password')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByText(passwordHints.ru, { exact: true })).toHaveCount(0)
})

test('valid reset submission reaches the BFF and replaces the form on success', async ({
  page,
}) => {
  let resetRequestSeen = false
  await page.route('**/api/auth/reset-password', (route) => {
    resetRequestSeen = true
    return route.fulfill({ status: 204, body: '' })
  })

  await page.goto(`/en/reset-password?token=${'a'.repeat(64)}`)
  const input = await expectPasswordHint(page, 'en')
  await input.fill('CorrectPassword1')
  await page.getByRole('button', { name: /reset password/i }).click()

  await expect(page.getByText(/your password has been reset/i)).toBeVisible()
  await expect(page.getByText(passwordHints.en, { exact: true })).toHaveCount(0)
  expect(resetRequestSeen).toBe(true)
})
