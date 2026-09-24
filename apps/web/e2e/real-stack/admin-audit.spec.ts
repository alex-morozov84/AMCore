import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import {
  countAuditViews,
  createAuditProbe,
  createNamedUser,
  getUserId,
  setSystemRole,
} from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test.use({ baseURL: process.env.T003_WEB_BASE_URL ?? 'http://localhost:3000' })

test('Audit navigation is deliberate, read-audited and fresh on history travel', async ({
  page,
}) => {
  const email = uniqueEmail('audit-browser')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  const marker = randomUUID()
  createAuditProbe(email, `${marker}-a`, 3)
  createAuditProbe(email, `${marker}-b`, 2)
  createAuditProbe(email, `${marker}-c`, 1)

  await page.goto('/en/admin')
  const nav = page.getByRole('link', { name: 'Audit', exact: true })
  await nav.hover()
  await page.waitForTimeout(500)
  expect(countAuditViews(email)).toBe(0)
  await nav.click()
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
  await expect(page.getByText(`${marker}-c`)).toBeVisible()
  expect(countAuditViews(email)).toBe(1)

  await page.goto(
    `/en/admin/audit?action=admin.cleanup.executed&actorId=${getUserId(email)}&limit=1`
  )
  await expect(page.getByText(`${marker}-c`)).toBeVisible()
  expect(countAuditViews(email)).toBe(2)
  await page.getByRole('link', { name: 'Older events' }).click()
  await expect(page.getByText(`${marker}-b`)).toBeVisible()
  expect(countAuditViews(email)).toBe(3)

  await page.goBack()
  await expect(page.getByText(`${marker}-c`)).toBeVisible()
  expect(countAuditViews(email)).toBe(4)

  setSystemRole(email, 'USER')
  await page.goForward()
  await expect(page.getByText(`${marker}-b`)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  expect(countAuditViews(email)).toBe(4)
})

test('Audit event and name journeys keep filters useful', async ({ page }) => {
  const email = uniqueEmail('audit-journey')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  const marker = randomUUID()
  createAuditProbe(email, marker, 1)

  await page.goto('/en/admin/audit?action=admin.cleanup.executed')
  const row = page.getByRole('listitem').filter({ hasText: marker })
  await expect(row).toContainText(email)
  await expect(row).toContainText('Current profile; may have changed since this event')
  await expect(row).toContainText('Event ID:')
  await expect(row).not.toContainText('Unsafe or unavailable ID')
  await row.getByRole('link', { name: 'Filter actor' }).click()
  await expect(page).toHaveURL(/actorId=/)
  await expect(row).toBeVisible()
  await page.getByRole('link', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/en\/admin\/audit$/)
  await page.getByRole('button', { name: 'Last 24 hours' }).click()
  await expect(page.getByRole('textbox', { name: 'From' })).not.toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'To', exact: true })).not.toHaveValue('')

  const token = `auditlookup${Date.now()}`
  for (let index = 0; index < 11; index++) {
    createNamedUser(`${token}${index}@e2e.amcore.test`, `${token}-${index}`, new Date())
  }
  const lookupResponse = page.waitForResponse((response) =>
    response.url().includes('/audit/lookup')
  )
  await page.getByLabel('Search current user by name or email').fill(token)
  const lookup = await lookupResponse
  expect(lookup.status()).toBe(200)
  await expect(page.getByText('First 10 shown — refine your search to find more.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Select current record/ })).toHaveCount(10)
  await page
    .getByRole('button', { name: /Select current record/ })
    .first()
    .click()
  await expect(page).toHaveURL(/actorId=/)
  await expect(page.locator('section[aria-live="polite"]')).toBeFocused()
})
