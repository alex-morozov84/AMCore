import { expect, type Page } from '@playwright/test'

import { completeMfaSignIn } from '../shared/mfa-login'
import { resetMfaDomainSourceBudgets } from '../support/mfa-domain-fixture.mjs'

/**
 * Real-stack specs register a fresh real account through `apps/api` on
 * every run instead of seeding/cleaning up rows directly — this lane's
 * whole point is exercising the real registration/auth path, and a unique
 * email per run means tests never collide with each other or with a
 * previous run's leftover data. The CI job's Postgres container is
 * ephemeral (destroyed with the job), so there's nothing to clean up
 * there; a persistent local dev database accumulates test accounts the
 * same way any local manual testing would.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.amcore.test`
}

/** Satisfies `registerSchema`: min 8 chars, an uppercase letter, a digit. */
export const TEST_PASSWORD = 'Test1234Secure'

/**
 * `name` is genuinely optional (`registerSchema`, `packages/shared`) — the
 * name field is left blank when `options.name` is omitted, exercising the
 * real optional-field contract end to end. `register-and-logout.spec.ts`
 * does exactly that; the other specs pass a name because filling it isn't
 * what they're testing.
 */
export async function registerViaUi(
  page: Page,
  email: string,
  options: { name?: string } = {}
): Promise<void> {
  resetMfaDomainSourceBudgets()
  await page.goto('/en/register')
  if (options.name) {
    await page.getByLabel(/name/i).fill(options.name)
  }
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  const registration = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/register') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /sign up/i }).click()
  const response = await registration
  if (response.status() !== 201) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      `Registration fixture rejected: status=${response.status()}, code=${body.errorCode ?? 'none'}, reference=${body.correlationId ?? 'none'}`
    )
  }
  expect(response.status()).toBe(201)
  // Callers may immediately close this context or assign a role to the new account.
  await page.waitForURL(/\/en\/?$/)
}

export async function loginViaUi(
  page: Page,
  email: string,
  options: { mfa?: 'complete' | 'manual' } = {}
): Promise<void> {
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /sign in/i }).click()
  if ((await response).status() === 202 && options.mfa !== 'manual')
    await completeMfaSignIn(page, email)
}

/** Sign out through the product shell's account menu (header), the only logout control there. */
export async function signOutViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('menuitem', { name: /sign out/i }).click()
}
