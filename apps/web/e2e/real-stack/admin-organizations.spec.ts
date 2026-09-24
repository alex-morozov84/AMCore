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

/**
 * Next's installed *Layouts and Pages* docs: a layout persists and does not
 * rerender on client-side navigation between sibling pages underneath it.
 * A role check only in `(protected)/layout.tsx` would stop
 * being a real gate the moment a second protected page exists - it would
 * only run once, on whichever page first mounted the layout. Each protected
 * page must call it itself. This proves that with a real client-side
 * transition (clicking the sidebar link), not `page.goto()` (a full
 * navigation, which would pass even with a layout-only check).
 */
test('client-side navigation back to Organizations re-checks a demotion that happened while elsewhere', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-clientnav')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/admin/organizations')
  await expect(page.getByRole('heading', { name: /organizations/i })).toBeVisible()

  await page.getByRole('link', { name: /overview/i }).click()
  await expect(page).toHaveURL(/\/en\/admin\/?$/)

  setSystemRole(email, 'USER')
  await page.getByRole('link', { name: /organizations/i }).click()
  await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /organizations/i })).toHaveCount(0)
})

test('path-mode Organizations panel paginates real data with the Next/Previous links', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-page2')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)

  const marker = Date.now()
  const lastOrgName = `Page2 Marker Org ${marker}`
  // `AdminService.findAllOrganizations` orders by `createdAt: 'desc'` - the
  // *oldest* row of a batch ends up on the later page. Create the marker
  // first, then 20 newer rows that outrank it in the descending sort, so it
  // reliably lands on page 2 regardless of any leftover rows from earlier
  // tests in this file (those are older still and only sink further).
  createOrganization(lastOrgName, `pagination-marker-${marker}`)
  for (let i = 0; i < 20; i += 1) {
    createOrganization(`Pagination Filler ${marker}-${i}`, `pagination-filler-${marker}-${i}`)
  }

  await page.goto('/en/admin/organizations')
  await expect(page.getByRole('cell', { name: lastOrgName })).toHaveCount(0)

  await page.getByLabel(/search organizations/i).fill('uncommitted-page-draft')
  await page.getByRole('link', { name: /next/i }).click()
  await expect(page).toHaveURL(/[?&]page=2\b/)
  await page.waitForTimeout(400)
  await expect(page).not.toHaveURL(/[?&]search=/)
  await expect(page.getByLabel(/search organizations/i)).toHaveValue('')
  await expect(page.getByRole('cell', { name: lastOrgName })).toBeVisible()

  await page.getByRole('link', { name: /previous/i }).click()
  // `page=1` is the canonical URL's default and is omitted, not written out
  // explicitly (`buildDiscoveryHref`) — so back on page 1 means no `page`
  // param at all, not `page=1`.
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByRole('cell', { name: lastOrgName })).toHaveCount(0)
})
