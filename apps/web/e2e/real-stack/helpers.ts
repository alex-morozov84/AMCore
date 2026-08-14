import type { Page } from '@playwright/test'

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
 * `registerSchema`'s `name` is `z.string().min(2).optional()` — optional
 * means the field may be omitted entirely (`undefined`), not that an empty
 * string passes; `RegisterForm`'s default value is `''`, which fails the
 * `min(2)` check the moment the form validates on submit. A real name is
 * simplest here, not a workaround for an app bug.
 */
export async function registerViaUi(page: Page, email: string): Promise<void> {
  await page.goto('/en/register')
  await page.getByLabel(/name/i).fill('E2E Test')
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign up/i }).click()
}

export async function loginViaUi(page: Page, email: string): Promise<void> {
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
}
