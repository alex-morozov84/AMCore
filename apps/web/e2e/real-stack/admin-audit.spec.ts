import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import {
  countAuditViews,
  createAuditProbe,
  createNamedUser,
  createOrganization,
  getUserId,
  setSystemRole,
} from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test.use({
  baseURL: process.env.T003_WEB_BASE_URL ?? 'http://localhost:3000',
  timezoneId: 'Europe/Moscow',
})

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
  await expect(page.getByRole('table').getByText(`${marker}-c`)).toBeVisible()
  if (process.env.T003_CAPTURE_UI) await page.screenshot({ path: process.env.T003_CAPTURE_UI })
  expect(countAuditViews(email)).toBe(1)

  await page.goto(
    `/en/admin/audit?action=admin.cleanup.executed&actorId=${getUserId(email)}&limit=1`
  )
  await expect(page.getByRole('table').getByText(`${marker}-c`)).toBeVisible()
  expect(countAuditViews(email)).toBe(2)
  await page.getByRole('link', { name: 'Older' }).click()
  await expect(page.getByRole('table').getByText(`${marker}-b`)).toBeVisible()
  expect(countAuditViews(email)).toBe(3)
  await page.getByRole('link', { name: 'Older' }).click()
  await expect(page.getByRole('table').getByText(`${marker}-a`)).toBeVisible()
  expect(countAuditViews(email)).toBe(4)
  await page.getByRole('link', { name: 'Newer' }).click()
  await expect(page.getByRole('table').getByText(`${marker}-b`)).toBeVisible()
  expect(countAuditViews(email)).toBe(5)
  await page.getByRole('link', { name: 'Newer' }).click()
  await expect(page.getByRole('table').getByText(`${marker}-c`)).toBeVisible()
  expect(countAuditViews(email)).toBe(6)

  setSystemRole(email, 'USER')
  await page.evaluate((oldRow) => {
    const state = window as typeof window & { auditOldRowVisible?: boolean }
    state.auditOldRowVisible = false
    const inspect = () => {
      if (
        [...document.querySelectorAll('tr')].some(
          (row) => row.textContent?.includes(oldRow) && row.getClientRects().length > 0
        )
      )
        state.auditOldRowVisible = true
    }
    new MutationObserver(inspect).observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  }, `${marker}-b`)
  await page.goBack()
  await expect(page.getByRole('table').getByText(`${marker}-b`)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as typeof window & { auditOldRowVisible?: boolean }).auditOldRowVisible
    )
  ).toBe(false)
  expect(countAuditViews(email)).toBe(6)
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
  const row = page.getByRole('row').filter({ hasText: marker })
  await expect(row).toContainText(email)
  await expect(
    page.getByText(
      'Names and email addresses come from current profiles and may have changed since the event.'
    )
  ).toBeVisible()
  await expect(row.getByRole('button', { name: /Copy ID/ }).first()).toBeVisible()
  await expect(row).not.toContainText('Unsafe or unavailable ID')
  await row.getByRole('link', { name: 'Filter actor' }).click()
  await expect(page).toHaveURL(/actorId=/)
  await expect(row).toBeVisible()
  await page.getByRole('link', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/en\/admin\/audit$/)
  await page.getByRole('button', { name: 'Last 24 hours' }).click()
  await page.getByRole('button', { name: 'Choose dates' }).click()
  await expect(page.getByLabel('Start time')).not.toHaveValue('')
  await expect(page.getByLabel('End time')).not.toHaveValue('')
  const today = new Date()
  const isoDay = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
  await expect(page.locator(`[data-day="${isoDay(1)}"] button`)).toBeDisabled()
  await page.locator(`[data-day="${isoDay(-1)}"] button`).click()
  await page.locator(`[data-day="${isoDay(0)}"] button`).click()
  await expect(page.getByRole('button', { name: 'Choose dates' })).toHaveAttribute(
    'aria-label',
    /\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/from=/)
  const utcBounds = new URL(page.url()).searchParams
  await page.getByRole('button', { name: 'Local time' }).click()
  await expect(page.getByText(/Europe\/Moscow \(currently UTC\+03:00\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/from=/)
  const localBounds = new URL(page.url()).searchParams
  expect(localBounds.get('from')).toBe(utcBounds.get('from'))
  expect(localBounds.get('to')).toBe(utcBounds.get('to'))
  await expectNoAxeViolations(page)

  const dateTrigger = page.getByRole('button', { name: 'Choose dates' })
  await dateTrigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Start time')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dateTrigger).toBeFocused()

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

  await page.getByRole('button', { name: 'Target', exact: true }).click()
  await page.getByLabel('Search current user by name or email').fill(token)
  await page.getByLabel('Search current user by name or email').press('Enter')
  await expect(page.getByRole('button', { name: /Select current record/ })).toHaveCount(10)
  await page
    .getByRole('button', { name: /Select current record/ })
    .first()
    .click()
  await expect(page).toHaveURL(/targetId=/)

  const organizationToken = `auditorg${Date.now()}`
  createOrganization(organizationToken, organizationToken)
  await page.getByLabel('Search current organization by name or slug').fill(organizationToken)
  await page.getByRole('button', { name: 'Find', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Select current record/ })).toHaveCount(1)
  await page.getByRole('button', { name: /Select current record/ }).click()
  await expect(page).toHaveURL(/organizationId=/)
})

test('Audit-view events are hidden until the operator enables them', async ({ page }) => {
  const email = uniqueEmail('audit-views')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  await page.goto('/en/admin/audit?limit=1')
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
  await expect(page.getByRole('table')).not.toContainText('admin.audit_logs.viewed')
  await page.getByRole('link', { name: 'Older' }).click()
  await expect(page).toHaveURL(/cursor=/)

  await page.getByRole('checkbox', { name: 'Show audit views' }).check()
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/includeReadEvents=true/)
  await expect(page).not.toHaveURL(/cursor=/)
  await expect(page.getByRole('table')).toContainText('admin.audit_logs.viewed')
})
