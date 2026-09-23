import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

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

  await page.getByRole('link', { name: /next/i }).click()
  await expect(page).toHaveURL(/[?&]page=2\b/)
  await expect(page.getByRole('cell', { name: lastOrgName })).toBeVisible()

  await page.getByRole('link', { name: /previous/i }).click()
  // `page=1` is the canonical URL's default and is omitted, not written out
  // explicitly (`buildDiscoveryHref`) — so back on page 1 means no `page`
  // param at all, not `page=1`.
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByRole('cell', { name: lastOrgName })).toHaveCount(0)
})

test('path-mode Organizations search filters against real data by a contains match, and clears back to the full list', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-search')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  const token = uniqueEmail('org-search-token').split('@')[0]
  const orgName = `Findable ${token}`
  createOrganization(orgName, `${token}-slug`)

  await page.goto('/en/admin/organizations')
  // This lane's local dev database persists and accumulates rows across
  // every run (`helpers.ts`), so the exact baseline total is unknown — only
  // that clearing the search must restore whatever it was.
  const total = page.locator('p[aria-live="polite"]')
  const baselineTotal = await total.textContent()

  await page.getByLabel(/search organizations/i).fill(token)
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page.getByRole('cell', { name: orgName })).toBeVisible()
  // A freshly generated random token can only ever match the one fixture
  // row seeded above — proves this is a real backend `WHERE` over the full
  // dataset, not a client-side no-op or a filter over an already-paginated
  // slice.
  await expect(total).toHaveText('1 organization')

  await page.getByRole('button', { name: /clear search/i }).click()
  await expect(page).not.toHaveURL(/[?&]search=/)
  await expect(total).toHaveText(baselineTotal ?? '')
})

test('path-mode Organizations sort-by-name header orders real rows and toggles aria-sort/direction', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-sort')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  const token = uniqueEmail('org-sort-token').split('@')[0]
  const now = new Date()
  createOrganization(`AAA-${token}`, `${token}-a`, now)
  createOrganization(`ZZZ-${token}`, `${token}-b`, now)

  await page.goto(`/en/admin/organizations?search=${token}`)
  await expect(page.getByRole('cell', { name: `AAA-${token}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: `ZZZ-${token}` })).toBeVisible()

  const nameHeader = page.getByRole('columnheader', { name: /^Sort by Name,/ })
  await nameHeader.getByRole('link').click()
  await expect(page).toHaveURL(/[?&]sortBy=name\b/)
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
  const rowsAsc = page.getByRole('row').filter({ hasText: token })
  await expect(rowsAsc.first()).toContainText(`AAA-${token}`)
  await expect(rowsAsc.last()).toContainText(`ZZZ-${token}`)

  await page
    .getByRole('columnheader', { name: /^Sort by Name,/ })
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/[?&]sortOrder=desc\b/)
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
  const rowsDesc = page.getByRole('row').filter({ hasText: token })
  await expect(rowsDesc.first()).toContainText(`ZZZ-${token}`)
  await expect(rowsDesc.last()).toContainText(`AAA-${token}`)
})

test('path-mode Organizations out-of-range recovery preserves the current search and sort', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-oor')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  const token = uniqueEmail('org-oor-token').split('@')[0]
  createOrganization(`Solo ${token}`, `${token}-solo`)

  await page.goto(`/en/admin/organizations?search=${token}&sortBy=name&sortOrder=desc&page=2`)
  // `EmptyTitle` (`shared/ui/empty.tsx`) renders a styled `<div>`, not a
  // heading element.
  await expect(page.getByText('This page is unavailable')).toBeVisible()

  const recoveryLink = page.getByRole('link', { name: /first page/i })
  await expect(recoveryLink).toHaveAttribute(
    'href',
    `/en/admin/organizations?search=${token}&sortBy=name&sortOrder=desc`
  )
  await recoveryLink.click()
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page).toHaveURL(/[?&]sortOrder=desc\b/)
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByRole('cell', { name: `Solo ${token}` })).toBeVisible()
})

test('path-mode Organizations search input resyncs from the URL on browser Back', async ({
  page,
}) => {
  const email = uniqueEmail('admin-orgs-back')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  // The debounced typing path commits via `router.replace()` (deliberate —
  // see `SearchInput.tsx`), which never adds a history entry to go back
  // to. The realistic source of two distinct history entries with
  // different `search` values is two separate real navigations.
  const tokenA = uniqueEmail('org-back-token-a').split('@')[0]
  const tokenB = uniqueEmail('org-back-token-b').split('@')[0]

  await page.goto(`/en/admin/organizations?search=${tokenA}`)
  await expect(page.getByLabel(/search organizations/i)).toHaveValue(tokenA)

  await page.goto(`/en/admin/organizations?search=${tokenB}`)
  await expect(page.getByLabel(/search organizations/i)).toHaveValue(tokenB)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`[?&]search=${tokenA}\\b`))
  await expect(page.getByLabel(/search organizations/i)).toHaveValue(tokenA)
})

test('the Organizations panel has no axe violations with an active search and a no-results state', async ({
  page,
}) => {
  const email = uniqueEmail('axe-orgs-search')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/admin/organizations')
  await expectNoAxeViolations(page)

  const token = uniqueEmail('axe-org-search-token').split('@')[0]
  await page.getByLabel(/search organizations/i).fill(token)
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page.getByText(/no matching organizations/i)).toBeVisible()
  await expectNoAxeViolations(page)
})

test('the Organizations panel has no axe violations with a non-default sort applied', async ({
  page,
}) => {
  const email = uniqueEmail('axe-orgs-sort')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/admin/organizations?sortBy=name&sortOrder=desc')
  await expect(page.getByRole('columnheader', { name: /^Sort by Name,/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  )
  await expectNoAxeViolations(page)
})
