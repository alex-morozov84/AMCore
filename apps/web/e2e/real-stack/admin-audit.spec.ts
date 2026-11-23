import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { requirePathConsole } from '../shared/console-applicability'
import { consolePath, isProductHome, messages, translate } from '../shared/product-settings'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import {
  countAuditViews,
  createAuditProbe,
  createNamedUser,
  createOrganization,
  getUserId,
  setSystemRole,
} from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

requirePathConsole()

test.use({
  baseURL: activeTarget().origins.product,
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
  await expect(page).toHaveURL(isProductHome)
  const marker = randomUUID()
  createAuditProbe(email, `${marker}-a`, 3)
  createAuditProbe(email, `${marker}-b`, 2)
  createAuditProbe(email, `${marker}-c`, 1)

  await page.goto(consolePath(''))
  const nav = page.getByRole('link', { name: messages.console.auditTitle, exact: true })
  await nav.hover()
  await page.waitForTimeout(500)
  expect(countAuditViews(email)).toBe(0)
  await nav.click()
  await expect(page.getByRole('heading', { name: messages.console.auditTitle })).toBeVisible()
  await expect(page.getByRole('table').getByText(`${marker}-c`)).toBeVisible()
  if (process.env.T003_CAPTURE_UI) await page.screenshot({ path: process.env.T003_CAPTURE_UI })
  expect(countAuditViews(email)).toBe(1)

  await page.goto(
    consolePath(`/audit?action=admin.cleanup.executed&actorId=${getUserId(email)}&limit=1`)
  )
  await expect(page.getByRole('table').getByText(`${marker}-c`)).toBeVisible()
  expect(countAuditViews(email)).toBe(2)
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 10 * 1024,
    uploadThroughput: 10 * 1024,
  })
  await page.evaluate(() => {
    const state = window as typeof window & { auditResultsSkeletonSeen?: boolean }
    state.auditResultsSkeletonSeen = false
    const inspect = () => {
      if (document.querySelector('[role="status"][aria-label="Loading audit events…"]'))
        state.auditResultsSkeletonSeen = true
    }
    new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true })
  })
  await page.getByRole('link', { name: messages.console.audit.older }).click()
  await expect(page.getByRole('table').getByText(`${marker}-b`)).toBeVisible()
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { auditResultsSkeletonSeen?: boolean }).auditResultsSkeletonSeen
    )
  ).toBe(true)
  expect(countAuditViews(email)).toBe(3)
  await page.getByRole('link', { name: messages.console.audit.older }).click()
  await expect(page.getByRole('table').getByText(`${marker}-a`)).toBeVisible()
  expect(countAuditViews(email)).toBe(4)
  await page.getByRole('link', { name: messages.console.audit.previous }).click()
  await expect(page.getByRole('table').getByText(`${marker}-b`)).toBeVisible()
  expect(countAuditViews(email)).toBe(5)
  await page.getByRole('link', { name: messages.console.audit.previous }).click()
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
  await expect(page).toHaveURL(isProductHome)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
  const marker = randomUUID()
  createAuditProbe(email, marker, 1)

  await page.goto(consolePath('/audit?action=admin.cleanup.executed'))
  const row = page.getByRole('row').filter({ hasText: marker })
  await expect(row).toContainText(email)
  await expect(page.getByText(messages.console.audit.identityNotice)).toBeVisible()
  await expect(
    row.getByRole('button', { name: messages.console.audit.copyId }).first()
  ).toBeVisible()
  await expect(row).not.toContainText(messages.console.audit.unknownId)
  await row.getByRole('link', { name: messages.console.audit.filterActor }).click()
  await expect(page).toHaveURL(/actorId=/)
  await expect(row).toBeVisible()
  await page.getByRole('link', { name: messages.console.audit.clear }).click()
  await expect(page).toHaveURL((url) => url.pathname === consolePath('/audit'))
  await page.getByRole('button', { name: messages.console.audit.recentDay }).click()
  await page.getByRole('button', { name: messages.console.audit.chooseDates }).click()
  await expect(page.getByLabel(messages.console.audit.startTime)).not.toHaveValue('')
  await expect(page.getByLabel(messages.console.audit.endTime)).not.toHaveValue('')
  const today = new Date()
  const isoDay = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
  const calendarDay = (offset: number) =>
    page.locator(`[data-day="${isoDay(offset)}"]:not([data-outside]) button`)
  await expect(calendarDay(1)).toBeDisabled()
  await calendarDay(-1).click()
  await calendarDay(0).click()
  await expect(
    page.getByRole('button', { name: messages.console.audit.chooseDates })
  ).toHaveAttribute('aria-label', /\d{2}[/.]\d{2}[/.]\d{4}.*\d{2}[/.]\d{2}[/.]\d{4}/)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: messages.console.audit.apply }).click()
  await expect(page).toHaveURL(/from=/)
  const utcBounds = new URL(page.url()).searchParams
  const zone = page.getByRole('combobox', { name: messages.console.timeZone.label })
  await zone.click()
  await page
    .getByRole('option', {
      name: translate('console.timeZone.localOption', {
        zone: 'Europe/Moscow',
        offset: 'UTC+03:00',
      }),
    })
    .click()
  await expect(zone).toContainText(translate('console.timeZone.display', { zone: 'UTC+03:00' }))
  await page.getByRole('button', { name: messages.console.audit.apply }).click()
  await expect(page).toHaveURL(/from=/)
  const localBounds = new URL(page.url()).searchParams
  expect(localBounds.get('from')).toBe(utcBounds.get('from'))
  expect(localBounds.get('to')).toBe(utcBounds.get('to'))
  await expectNoAxeViolations(page)

  const dateTrigger = page.getByRole('button', { name: messages.console.audit.chooseDates })
  await dateTrigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel(messages.console.audit.startTime)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dateTrigger).toBeFocused()

  const token = `auditlookup${Date.now()}`
  for (let index = 0; index < 11; index++) {
    createNamedUser(`${token}${index}@e2e.amcore.test`, `${token}-${index}`, new Date())
  }
  const lookupResponse = page.waitForResponse((response) =>
    response.url().includes('/audit/lookup')
  )
  await page.getByLabel(messages.console.audit.lookupUser).fill(token)
  const lookup = await lookupResponse
  expect(lookup.status()).toBe(200)
  await expect(page.getByText(messages.console.audit.lookupRefine)).toBeVisible()
  await expect(page.getByRole('button', { name: messages.console.audit.lookupSelect })).toHaveCount(
    10
  )
  await page.getByRole('button', { name: messages.console.audit.lookupSelect }).first().click()
  await expect(page).toHaveURL(/actorId=/)
  await expect(page.locator('section[aria-live="polite"]')).toBeFocused()

  await page.getByRole('button', { name: messages.console.audit.target, exact: true }).click()
  await page.getByLabel(messages.console.audit.lookupUser).fill(token)
  await page.getByLabel(messages.console.audit.lookupUser).press('Enter')
  await expect(page.getByRole('button', { name: messages.console.audit.lookupSelect })).toHaveCount(
    10
  )
  await page.getByRole('button', { name: messages.console.audit.lookupSelect }).first().click()
  await expect(page).toHaveURL(/targetId=/)

  const organizationToken = `auditorg${Date.now()}`
  createOrganization(organizationToken, organizationToken)
  await page.getByLabel(messages.console.audit.lookupOrganization).fill(organizationToken)
  await page.getByLabel(messages.console.audit.lookupOrganization).press('Enter')
  await expect(page.getByRole('button', { name: messages.console.audit.lookupSelect })).toHaveCount(
    1
  )
  await page.getByRole('button', { name: messages.console.audit.lookupSelect }).click()
  await expect(page).toHaveURL(/organizationId=/)
})

test('Audit-view events are hidden until the operator enables them', async ({ page }) => {
  const email = uniqueEmail('audit-views')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
  // Seed an owned read event inside the initial time window. Later page reads
  // occur after that fixed window and are not guaranteed to be its first row.
  expect(
    guardedSql(
      `INSERT INTO core.audit_log (id, "createdAt", "actorType", "actorId", action, category, metadata)
     SELECT :'marker', now(), 'USER', id, 'admin.audit_logs.viewed', 'SECURITY', '{}'::jsonb
     FROM core.users WHERE "emailCanonical" = :'email';`,
      { marker: randomUUID(), email }
    ).trim()
  ).toBe('INSERT 0 1')
  await page.goto(consolePath('/audit?limit=1'))
  await expect(page.getByRole('heading', { name: messages.console.auditTitle })).toBeVisible()
  await expect(page.getByRole('table')).not.toContainText('admin.audit_logs.viewed')
  await page.getByRole('link', { name: messages.console.audit.older }).click()
  await expect(page).toHaveURL(/cursor=/)

  await page.getByRole('checkbox', { name: messages.console.audit.includeReadEvents }).check()
  await page.getByRole('button', { name: messages.console.audit.apply }).click()
  await expect(page).toHaveURL(/includeReadEvents=true/)
  await expect(page).not.toHaveURL(/cursor=/)
  await expect(page.getByRole('table')).toContainText('admin.audit_logs.viewed')
})
