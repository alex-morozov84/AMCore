import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { createNamedUser, createUsersForPagination, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

async function signInAsPathAdmin(page: Page, email: string) {
  await registerViaUi(page, email, { name: 'Path Inventory User' })
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
}

test('path-mode Users inventory renders real user data without exposing a token', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users')
  await signInAsPathAdmin(page, email)
  const requestsWithAuthHeader: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
  })

  await page.goto('/en/admin/users')

  await expect(page.getByRole('heading', { name: /users/i })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: email }).getByRole('cell', { name: 'Super admin' })
  ).toBeVisible()
  expect(await page.content()).not.toContain('Bearer ')
  expect(requestsWithAuthHeader).toHaveLength(0)
})

test('path-mode client navigation removes console chrome after a live denial', async ({ page }) => {
  const email = uniqueEmail('admin-users-denied')
  await signInAsPathAdmin(page, email)
  await page.goto('/en/admin/users')
  await expect(page.getByRole('heading', { name: /users/i })).toBeVisible()

  await page.getByRole('link', { name: /overview/i }).click()
  await expect(page).toHaveURL(/\/en\/admin\/?$/)
  setSystemRole(email, 'USER')

  await page.getByRole('link', { name: /users/i }).click()
  await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /users/i })).toHaveCount(0)
  await expect(page.locator('[data-console-shell="title"]')).toHaveCount(0)
  await expect(page.getByText('Path Inventory User')).toHaveCount(0)
})

test('path-mode client navigation retains the collapsed sidebar preference', async ({ page }) => {
  const email = uniqueEmail('admin-users-sidebar')
  await signInAsPathAdmin(page, email)
  await page.goto('/en/admin/users')

  const sidebar = page.locator('[data-slot="sidebar"]').first()
  await page
    .getByRole('button', { name: /toggle.*navigation/i })
    .first()
    .click()
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')

  await page.getByRole('link', { name: /overview/i }).click()
  await expect(page).toHaveURL(/\/en\/admin\/?$/)
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute(
    'data-state',
    'collapsed'
  )
})

test('path-mode Users inventory paginates with progress-aware Next and Previous links', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users-page2')
  await signInAsPathAdmin(page, email)
  const markerEmail = uniqueEmail('users-page2-marker')
  createUsersForPagination(markerEmail, `users-page2-filler-${Date.now()}`)

  await page.goto('/en/admin/users')
  await expect(page.getByText(markerEmail)).toHaveCount(0)

  await page.getByRole('link', { name: /next/i }).click()
  await expect(page).toHaveURL(/[?&]page=2\b/)
  await expect(page.getByText(markerEmail)).toBeVisible()

  await page.getByRole('link', { name: /previous/i }).click()
  // `page=1` is the canonical URL's default and is omitted, not written out
  // explicitly (`buildDiscoveryHref`) — so back on page 1 means no `page`
  // param at all, not `page=1`.
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByText(markerEmail)).toHaveCount(0)
})

test('path-mode Users search filters against real data by a contains match, and clears back to the full list', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users-search')
  await signInAsPathAdmin(page, email)
  const token = uniqueEmail('search-token').split('@')[0]
  const targetEmail = `${token}@e2e.amcore.test`
  createNamedUser(targetEmail, `Findable ${token}`, new Date())

  await page.goto('/en/admin/users')
  // This lane's local dev database persists and accumulates rows across
  // every run (`helpers.ts`), so the exact baseline total is unknown — only
  // that clearing the search must restore whatever it was.
  const total = page.locator('p[aria-live="polite"]')
  const baselineTotal = await total.textContent()

  await page.getByLabel(/search users/i).fill(token)
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page.getByText(targetEmail)).toBeVisible()
  // A freshly generated random token can only ever match the one fixture
  // row seeded above — proves this is a real backend `WHERE` over the full
  // dataset, not a client-side no-op or a filter over an already-paginated
  // slice (where an unrelated match could coincidentally also be absent).
  await expect(total).toHaveText('1 user')

  await page.getByRole('button', { name: /clear search/i }).click()
  await expect(page).not.toHaveURL(/[?&]search=/)
  await expect(total).toHaveText(baselineTotal ?? '')
})

test('path-mode Users sort-by-name header orders real rows and toggles aria-sort/direction', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users-sort')
  await signInAsPathAdmin(page, email)
  const token = uniqueEmail('sort-token').split('@')[0]
  const now = new Date()
  createNamedUser(`${token}-a@e2e.amcore.test`, `AAA-${token}`, now)
  createNamedUser(`${token}-b@e2e.amcore.test`, `ZZZ-${token}`, now)

  await page.goto(`/en/admin/users?search=${token}`)
  await expect(page.getByText(`AAA-${token}`)).toBeVisible()
  await expect(page.getByText(`ZZZ-${token}`)).toBeVisible()

  const userHeader = page.getByRole('columnheader', { name: /^Sort by User,/ })
  await page.getByLabel(/search users/i).fill('uncommitted-sort-draft')
  await userHeader.getByRole('link').click()
  await expect(page).toHaveURL(/[?&]sortBy=name\b/)
  await page.waitForTimeout(400)
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page.getByLabel(/search users/i)).toHaveValue(token)
  await expect(userHeader).toHaveAttribute('aria-sort', 'ascending')
  const rowsAsc = page.getByRole('row').filter({ hasText: token })
  await expect(rowsAsc.first()).toContainText(`AAA-${token}`)
  await expect(rowsAsc.last()).toContainText(`ZZZ-${token}`)

  await page
    .getByRole('columnheader', { name: /^Sort by User,/ })
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/[?&]sortOrder=desc\b/)
  await expect(userHeader).toHaveAttribute('aria-sort', 'descending')
  const rowsDesc = page.getByRole('row').filter({ hasText: token })
  await expect(rowsDesc.first()).toContainText(`ZZZ-${token}`)
  await expect(rowsDesc.last()).toContainText(`AAA-${token}`)
})

test('path-mode Users out-of-range recovery preserves the current search and sort', async ({
  page,
}) => {
  const email = uniqueEmail('admin-users-oor')
  await signInAsPathAdmin(page, email)
  const token = uniqueEmail('oor-token').split('@')[0]
  createNamedUser(`${token}@e2e.amcore.test`, `Solo ${token}`, new Date())

  await page.goto(`/en/admin/users?search=${token}&sortBy=name&sortOrder=desc&page=2`)
  // `EmptyTitle` (`shared/ui/empty.tsx`) renders a styled `<div>`, not a
  // heading element — matches `UsersOutOfRange.test.tsx`'s own assertion
  // style.
  await expect(page.getByText('This page is unavailable')).toBeVisible()

  const recoveryLink = page.getByRole('link', { name: /first page/i })
  await expect(recoveryLink).toHaveAttribute(
    'href',
    `/en/admin/users?search=${token}&sortBy=name&sortOrder=desc`
  )
  await recoveryLink.click()
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page).toHaveURL(/[?&]sortOrder=desc\b/)
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByText(`Solo ${token}`)).toBeVisible()
})

test('path-mode Users search input resyncs from the URL on browser Back', async ({ page }) => {
  const email = uniqueEmail('admin-users-back')
  await signInAsPathAdmin(page, email)

  // The debounced typing path commits via `router.replace()` (deliberate —
  // see `SearchInput.tsx`), which never adds a history entry to go back
  // to. The realistic source of two distinct history entries with
  // different `search` values is two separate real navigations — a
  // bookmark, a pasted link, or (as here) landing on two different URLs
  // directly — exactly the "canonical URL changed from outside this
  // component" case `SearchInput` resyncs for.
  const tokenA = uniqueEmail('back-token-a').split('@')[0]
  const tokenB = uniqueEmail('back-token-b').split('@')[0]

  await page.goto(`/en/admin/users?search=${tokenA}`)
  await expect(page.getByLabel(/search users/i)).toHaveValue(tokenA)

  await page.goto(`/en/admin/users?search=${tokenB}`)
  await expect(page.getByLabel(/search users/i)).toHaveValue(tokenB)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`[?&]search=${tokenA}\\b`))
  await expect(page.getByLabel(/search users/i)).toHaveValue(tokenA)
})

test('the Users panel has no axe violations with an active search and a no-results state', async ({
  page,
}) => {
  const email = uniqueEmail('axe-users-search')
  await signInAsPathAdmin(page, email)

  await page.goto('/en/admin/users')
  await expectNoAxeViolations(page)

  const token = uniqueEmail('axe-search-token').split('@')[0]
  await page.getByLabel(/search users/i).fill(token)
  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  // A random token matches nothing — covers the "no results for your
  // search" empty state, not just the populated table.
  await expect(page.getByText(/no matching users/i)).toBeVisible()
  await expectNoAxeViolations(page)
})

test('the Users panel has no axe violations with a non-default sort applied', async ({ page }) => {
  const email = uniqueEmail('axe-users-sort')
  await signInAsPathAdmin(page, email)

  await page.goto('/en/admin/users?sortBy=name&sortOrder=desc')
  await expect(page.getByRole('columnheader', { name: /^Sort by User,/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  )
  await expectNoAxeViolations(page)
})
