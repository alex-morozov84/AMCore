import { expect, test } from '@playwright/test'

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

  await page.getByRole('textbox', { name: /email/i }).fill('spike-e2e@example.com')
  // `registerSchema` requires min 8 chars + an uppercase + a digit.
  await page.getByLabel(/password/i).fill('weak')
  await page.getByRole('button', { name: /sign up/i }).click()

  await expect(page.getByLabel(/password/i)).toHaveAttribute('aria-invalid', 'true')
  expect(registerRequestSeen).toBe(false)
})
