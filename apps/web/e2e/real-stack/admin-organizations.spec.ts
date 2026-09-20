import { expect, test } from '@playwright/test'

import { createOrganization, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

/**
 * Path mode (this checkout's configured topology - `PROJECT_CONTEXT.md`)
 * has no separate console login: a SUPER_ADMIN signs into the ordinary
 * product session, then opens `/admin` directly (`docs/operations-console/
 * README.md`). This proves the Organizations panel's real data path over
 * that reused session, mirroring `console-real-stack/organizations.spec.ts`'s
 * host-mode coverage of the same panel.
 *
 * `SystemRolesGuard` (`apps/api/src/core/auth/guards/system-roles.guard.ts`,
 * OB-06a/ADR-037) requires the JWT's `systemRole` *claim* to already satisfy
 * the route, intersected with the live DB role - a promotion only takes
 * effect on a token minted *after* it, by design (the asymmetric guard
 * against a stale-promotion replay). So every test that expects SUPER_ADMIN
 * access must re-authenticate after `setSystemRole(..., 'SUPER_ADMIN')`,
 * not just update the row and reuse the already-issued session.
 */
test('path-mode Organizations panel renders real data via the reused product session', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs')
  await registerViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  const orgName = `Path E2E Org ${Date.now()}`
  const orgSlug = `path-e2e-org-${Date.now()}`
  createOrganization(orgName, orgSlug)

  const requestsWithAuthHeader: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  await page.goto('/en/admin/organizations')
  await expect(page.getByRole('cell', { name: orgName })).toBeVisible()
  await expect(page.getByRole('cell', { name: orgSlug })).toBeVisible()

  const html = await page.content()
  expect(html).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)
})

test('path-mode Organizations panel denies a demoted session with a live re-check', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-denied')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/admin/organizations')
  await expect(page.getByRole('heading', { name: /organizations/i })).toBeVisible()

  // Demotion, unlike promotion above, takes effect on the *existing* token:
  // the guard's live current-DB-role read (not the JWT claim) catches it.
  setSystemRole(email, 'USER')
  const response = await page.goto('/en/admin/organizations')
  expect(response?.status()).toBe(404)
})
