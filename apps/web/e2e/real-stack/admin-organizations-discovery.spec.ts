import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { createOrganization, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

async function signInAsPathAdmin(page: Page, prefix: string) {
  const email = uniqueEmail(prefix)
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
}

test('Organizations search filters real data, resets page, and clears', async ({ page }) => {
  await signInAsPathAdmin(page, 'admin-orgs-search')
  const token = uniqueEmail('org-search-token').split('@')[0]
  const orgName = `Findable ${token}`
  createOrganization(orgName, `${token}-slug`)

  await page.goto('/en/admin/organizations?page=2')
  const total = page.locator('p[aria-live="polite"]')
  const baselineTotal = await total.textContent()
  await page.getByLabel(/search organizations/i).fill(token)

  await expect(page).toHaveURL(new RegExp(`[?&]search=${token}\\b`))
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByRole('cell', { name: orgName })).toBeVisible()
  await expect(total).toHaveText('1 organization')

  await page.getByRole('button', { name: /clear search/i }).click()
  await expect(page).not.toHaveURL(/[?&]search=/)
  await expect(total).toHaveText(baselineTotal ?? '')
})

test('Organizations sort-by-name orders real rows and toggles aria-sort', async ({ page }) => {
  await signInAsPathAdmin(page, 'admin-orgs-sort')
  const token = uniqueEmail('org-sort-token').split('@')[0]
  const now = new Date()
  createOrganization(`AAA-${token}`, `${token}-a`, now)
  createOrganization(`ZZZ-${token}`, `${token}-b`, now)

  await page.goto(`/en/admin/organizations?search=${token}`)
  const nameHeader = page.getByRole('columnheader', { name: /^Sort by Name,/ })
  await nameHeader.getByRole('link').click()
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
  let rows = page.getByRole('row').filter({ hasText: token })
  await expect(rows.first()).toContainText(`AAA-${token}`)
  await expect(rows.last()).toContainText(`ZZZ-${token}`)

  await nameHeader.getByRole('link').click()
  await expect(page).toHaveURL(/[?&]sortOrder=desc\b/)
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
  rows = page.getByRole('row').filter({ hasText: token })
  await expect(rows.first()).toContainText(`ZZZ-${token}`)
  await expect(rows.last()).toContainText(`AAA-${token}`)
})

test('Organizations out-of-range recovery preserves search and sort', async ({ page }) => {
  await signInAsPathAdmin(page, 'admin-orgs-oor')
  const token = uniqueEmail('org-oor-token').split('@')[0]
  createOrganization(`Solo ${token}`, `${token}-solo`)

  await page.goto(`/en/admin/organizations?search=${token}&sortBy=name&sortOrder=desc&page=2`)
  await expect(page.getByText('This page is unavailable')).toBeVisible()
  const recoveryLink = page.getByRole('link', { name: /first page/i })
  await expect(recoveryLink).toHaveAttribute(
    'href',
    `/en/admin/organizations?search=${token}&sortBy=name&sortOrder=desc`
  )
  await recoveryLink.click()
  await expect(page).not.toHaveURL(/[?&]page=/)
  await expect(page.getByRole('cell', { name: `Solo ${token}` })).toBeVisible()
})

test('Organizations search input resyncs from the URL on browser Back', async ({ page }) => {
  await signInAsPathAdmin(page, 'admin-orgs-back')
  const tokenA = uniqueEmail('org-back-token-a').split('@')[0]
  const tokenB = uniqueEmail('org-back-token-b').split('@')[0]

  await page.goto(`/en/admin/organizations?search=${tokenA}`)
  await expect(page.getByLabel(/search organizations/i)).toHaveValue(tokenA)
  await page.goto(`/en/admin/organizations?search=${tokenB}`)
  await expect(page.getByLabel(/search organizations/i)).toHaveValue(tokenB)
  await page.goBack()
  await expect(page.getByLabel(/search organizations/i)).toHaveValue(tokenA)
})

test('Organizations discovery states have no axe violations', async ({ page }) => {
  await signInAsPathAdmin(page, 'axe-orgs-discovery')
  const token = uniqueEmail('axe-org-search-token').split('@')[0]

  await page.goto(`/en/admin/organizations?search=${token}`)
  await expect(page.getByText(/no matching organizations/i)).toBeVisible()
  await expectNoAxeViolations(page)

  await page.goto('/en/admin/organizations?sortBy=name&sortOrder=desc')
  await expect(page.getByRole('columnheader', { name: /^Sort by Name,/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  )
  await expectNoAxeViolations(page)
})
