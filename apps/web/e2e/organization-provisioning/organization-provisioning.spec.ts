import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'
import { proveSetupMailbox, SETUP_PASSWORD, setupCommand } from '../support/organization-setup'

import { acceptAdministrator } from './recipient'

test.use({ trace: 'off', video: 'off', screenshot: 'off' })
test('operator steps, lost reply and actual recipient consent produce a working ADMIN', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000)
  const m = activeTarget()
  const copy = (locale: string) =>
    JSON.parse(readFileSync(join(m.snapshot, `apps/web/messages/${locale}.json`), 'utf8'))
  const en = copy(DEFAULT_LOCALE)
  const alternateLocale =
    SUPPORTED_LOCALES.find((locale) => String(locale) === 'ru') ?? DEFAULT_LOCALE
  const ru = copy(alternateLocale)
  const operatorEmail = 'operator@e2e.amcore.test'
  const recipientEmail = 'first-admin@e2e.amcore.test'
  const prepared = setupCommand('prepare-account', { email: operatorEmail, locale: DEFAULT_LOCALE })
  await proveSetupMailbox(page, operatorEmail)
  guardedSql(
    'UPDATE core.users SET "systemRole"=\'SUPER_ADMIN\' WHERE id=:\'id\' AND "emailVerified"=true;',
    { id: prepared.userId }
  )
  const consoleOrigin = m.origins.console ?? m.origins.product
  await page.goto(localizedFrontendUrl(consoleOrigin, DEFAULT_LOCALE, 'login'))
  await page.getByRole('textbox', { name: en.auth.email, exact: true }).fill(operatorEmail)
  await page.getByLabel(en.auth.password, { exact: true }).fill(SETUP_PASSWORD)
  await page.getByRole('button', { name: en.auth.login, exact: true }).click()
  await page.waitForURL(
    (url) =>
      url.origin === consoleOrigin &&
      url.pathname === new URL(localizedFrontendUrl(consoleOrigin, DEFAULT_LOCALE)).pathname
  )
  await page.goto(localizedFrontendUrl(consoleOrigin, DEFAULT_LOCALE, 'organizations'))
  const t = en.console.organizationProvisioning
  const flow = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: t.title, exact: true }) })
  await flow.getByRole('button', { name: t.start, exact: true }).click()
  await flow.getByLabel(t.name, { exact: true }).fill('North shop')
  await flow.getByLabel(t.slug, { exact: true }).fill('north-shop')
  await flow.getByRole('button', { name: t.next, exact: true }).click()
  await flow.getByLabel(t.email, { exact: true }).fill(recipientEmail)
  await flow.getByRole('button', { name: t.next, exact: true }).click()
  await expect(flow.getByText(t.reviewHelp, { exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
  // Drop only the browser's success acknowledgment. The real browser request keeps
  // its own TLS/proxy/Host/Origin/cookies; APIRequestContext replay is a different transport.
  await page.evaluate(() => {
    const send = window.fetch.bind(window)
    let intercepted = false
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.origin
      )
      const target =
        !intercepted &&
        url.pathname === '/api/organization-provisionings' &&
        (init?.method ?? 'GET') === 'POST'
      if (target) intercepted = true
      const response = await send(input, init)
      if (target && response.status === 201)
        throw new TypeError('Controlled lost creation acknowledgment')
      return response
    }
  })
  await flow.getByRole('button', { name: t.createAndInvite, exact: true }).click()
  await expect(flow.getByText(t.unknown, { exact: true })).toBeVisible()
  await expect(flow.getByRole('button', { name: t.checkResult, exact: true })).toBeEnabled()
  await page.reload()
  await flow.getByRole('button', { name: t.checkResult, exact: true }).click()
  await expect(page.getByRole('heading', { name: t.created, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: t.openOrganization })).toBeVisible()
  const orgId = guardedSql("SELECT id FROM core.organizations WHERE slug='north-shop';").trim()
  expect(guardedSql('SELECT count(*) FROM core.org_members;').trim()).toBe('0')

  const firstUserId = await acceptAdministrator(browser, recipientEmail, 'North shop', en)
  expect(
    guardedSql(
      'SELECT count(*) FROM core.member_roles mr JOIN core.roles r ON r.id=mr."roleId" JOIN core.org_members m ON m.id=mr."memberId" WHERE m."organizationId"=:\'org\' AND r.name=\'ADMIN\';',
      { org: orgId }
    ).trim()
  ).toBe('1')
  expect(
    guardedSql('SELECT count(*) FROM core.org_members WHERE "userId"=:\'id\';', {
      id: prepared.userId,
    }).trim()
  ).toBe('0')
  await page.goto(localizedFrontendUrl(consoleOrigin, alternateLocale, `organizations/${orgId}`))
  await page.setViewportSize({ width: 375, height: 900 })
  await expect(
    page.getByRole('heading', {
      name: ru.console.organizationAdministration.adminsTitle,
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: ru.console.organizationProvisioning.replace, exact: true })
  ).toHaveCount(0)
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // New initial cancellation is terminal; a distinct additional invitation repairs the same organization.
  await page.setViewportSize({ width: 1280, height: 1000 })
  async function createOrganization(name: string, slug: string, email: string) {
    await page.goto(localizedFrontendUrl(consoleOrigin, DEFAULT_LOCALE, 'organizations'))
    await page.getByRole('button', { name: t.start, exact: true }).click()
    await page.getByLabel(t.name, { exact: true }).fill(name)
    await page.getByLabel(t.slug, { exact: true }).fill(slug)
    await page.getByRole('button', { name: t.next, exact: true }).click()
    await page.getByLabel(t.email, { exact: true }).fill(email)
    await page.getByRole('button', { name: t.next, exact: true }).click()
    await page.getByRole('button', { name: t.createAndInvite, exact: true }).click()
    const result = page.getByRole('dialog')
    await expect(result.getByRole('heading', { name: t.created, exact: true })).toBeVisible()
    await result.getByRole('link', { name: t.openOrganization, exact: true }).click()
  }
  await createOrganization('South shop', 'south-shop', 'cancelled-first@e2e.amcore.test')
  const southId = guardedSql("SELECT id FROM core.organizations WHERE slug='south-shop';").trim()
  await page.getByRole('button', { name: t.endWithoutAdmin, exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t.confirmCancel, exact: true })
    .click()
  const admin = en.console.organizationAdministration
  await expect(page.getByRole('button', { name: admin.invite, exact: true })).toBeEnabled()
  await page.getByRole('button', { name: admin.invite, exact: true }).click()
  const invitation = page.getByRole('dialog')
  await invitation.getByLabel(admin.email, { exact: true }).fill('second-admin@e2e.amcore.test')
  await invitation
    .getByLabel(admin.reason, { exact: true })
    .fill('TEST-49 recover cancelled initial invitation')
  await invitation.getByRole('button', { name: admin.continue, exact: true }).click()
  await invitation.getByRole('button', { name: admin.confirmInvite, exact: true }).click()
  await expect(page.getByText(admin.sent, { exact: true })).toBeVisible()
  await createOrganization('West shop', 'west-shop', 'later-admin@e2e.amcore.test')
  await page.goto(localizedFrontendUrl(consoleOrigin, DEFAULT_LOCALE, 'organizations'))
  const attention = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: admin.attentionTitle, exact: true }) })
  await expect(attention.getByRole('heading', { name: 'South shop', exact: true })).toBeVisible()
  await expect(attention.getByRole('heading', { name: 'West shop', exact: true })).toBeVisible()
  await acceptAdministrator(browser, 'second-admin@e2e.amcore.test', 'South shop', en)
  await attention.getByRole('button', { name: admin.attentionRefresh, exact: true }).click()
  await expect(attention.getByRole('heading', { name: 'South shop', exact: true })).toHaveCount(0)
  await expect(attention.getByRole('heading', { name: 'West shop', exact: true })).toBeVisible()
  // The first recipient has real mailbox proof already. Seed only an ordinary MEMBER of this second organization.
  guardedSql(
    `INSERT INTO core.org_members (id,"userId","organizationId","createdAt") VALUES ('proof-south-member',:'user',:'org',CURRENT_TIMESTAMP); INSERT INTO core.member_roles (id,"memberId","roleId") SELECT 'proof-south-member-role','proof-south-member',id FROM core.roles WHERE name='MEMBER' AND "organizationId" IS NULL;`,
    { user: firstUserId, org: southId }
  )
  await page.goto(localizedFrontendUrl(consoleOrigin, DEFAULT_LOCALE, `organizations/${southId}`))
  await page.getByRole('button', { name: admin.promote, exact: true }).click()
  const promotion = page.getByRole('dialog')
  await promotion.getByLabel(admin.reason, { exact: true }).fill('TEST-49 verified member addition')
  await promotion.getByRole('button', { name: admin.reviewAction, exact: true }).click()
  await promotion.getByRole('button', { name: admin.promote, exact: true }).click()
  await expect(page.getByText(admin.assigned, { exact: true })).toBeVisible()
  expect(
    guardedSql(
      `SELECT count(*) FROM core.member_roles r JOIN core.org_members m ON m.id=r."memberId" JOIN core.roles role ON role.id=r."roleId" WHERE m."organizationId"=:'org' AND role.name='ADMIN';`,
      { org: southId }
    ).trim()
  ).toBe('2')
  for (const [locale, messages] of SUPPORTED_LOCALES.map(
    (locale) => [locale, copy(locale)] as const
  )) {
    await page.goto(localizedFrontendUrl(consoleOrigin, locale, `organizations/${southId}`))
    await page.setViewportSize({ width: 375, height: 900 })
    await expect(
      page.getByRole('heading', {
        name: messages.console.organizationAdministration.adminsTitle,
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByText('second-admin@e2e.amcore.test', { exact: true }).first()
    ).toBeVisible()
    await expectNoAxeViolations(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
