import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { acceptAdministrator } from '../organization-provisioning/recipient'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'
import { proveSetupMailbox, SETUP_PASSWORD, setupCommand } from '../support/organization-setup'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('closed signup still admits invited registration and real email proof before membership on staff host', async ({
  browser,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const { product, staff } = target.origins
  if (!staff || target.fixtureProfile !== 'product-admin-closed-signup')
    throw new Error('Closed staff fixture required')
  const messages = JSON.parse(
    readFileSync(join(target.snapshot, 'apps/web/messages/en.json'), 'utf8')
  )
  const operator = 'staff-owner@e2e.amcore.test'
  const recipient = 'staff-invited@e2e.amcore.test'
  const prepared = setupCommand('prepare-account', { email: operator, locale: 'en' })
  const context = await browser.newContext({
    baseURL: product,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  try {
    const page = await context.newPage()
    await proveSetupMailbox(page, operator)
    expect(
      setupCommand('bootstrap', {
        name: 'Staff invitation proof',
        slug: 'staff-invitation-proof',
        adminUserId: prepared.userId,
      }).status
    ).toBe('created')
    await page.goto(`${product}/en/register`)
    await expect(page.getByText(messages.auth.publicSignupClosed, { exact: true })).toBeVisible()
    await page.goto(`${staff}/en/login`)
    await page.getByLabel(messages.auth.email, { exact: true }).fill(operator)
    await page.getByLabel(messages.auth.password, { exact: true }).fill(SETUP_PASSWORD)
    await page.getByRole('button', { name: messages.auth.login, exact: true }).click()
    await page.waitForURL((url) => url.origin === staff && !url.pathname.endsWith('/login'))
    const org = guardedSql(
      "SELECT id FROM core.organizations WHERE slug='staff-invitation-proof';"
    ).trim()
    await page.goto(`${staff}/en/organizations/${org}/invites`)
    await page
      .getByRole('button', { name: messages.organizationInvitations.invite, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(messages.auth.email, { exact: true }).fill(recipient)
    await dialog
      .getByRole('button', { name: messages.organizationInvitations.invite, exact: true })
      .click()
    await expect(dialog).not.toBeVisible()
    const userId = await acceptAdministrator(
      browser,
      recipient,
      'Staff invitation proof',
      messages,
      staff
    )
    expect(
      guardedSql(
        'SELECT count(*) FROM core.org_members WHERE "userId"=:\'id\' AND "organizationId"=:\'org\';',
        { id: userId, org }
      ).trim()
    ).toBe('1')
    expect(
      guardedSql(
        'SELECT "frontendDestination" FROM core.org_invites WHERE "emailCanonical"=:\'email\';',
        { email: recipient }
      ).trim()
    ).toBe('admin')
  } finally {
    await context.close()
  }
})
