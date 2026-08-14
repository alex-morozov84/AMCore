import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from './helpers'

/**
 * Real-stack lane (Track 7 FINAL PLAN §4, `ai/models-talk.md`): a real
 * `POST /api/auth/register` against `apps/api`/Postgres via the BFF, real
 * cookie-backed session vault (Redis). No mocking — `page.route()` can't
 * reach either side of this, and that's exactly why this flow belongs here
 * instead of the mocked lane.
 *
 * Deliberately registers with no `name` — `registerSchema`'s `name` is
 * optional, and this is the end-to-end proof that omitting it really works
 * (the dashboard's generic "Welcome!" instead of "Welcome, {name}!" is the
 * observable signal that no name reached the backend).
 */
test('register creates an account, lands on the dashboard, and logout signs out', async ({
  page,
}) => {
  await registerViaUi(page, uniqueEmail('register-logout'))

  await expect(page).toHaveURL(/\/en\/?$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome!')

  await page.getByRole('button', { name: /sign out/i }).click()
  await expect(page).toHaveURL(/\/en\/login/)
})
