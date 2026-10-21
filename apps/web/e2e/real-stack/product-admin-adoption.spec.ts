import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl, productAdminPath } from '@amcore/shared'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { closeCredentialPage } from '../shared/credential-artifacts'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'
import { organizationUi } from './organization-context.helpers'

// This declaration follows the spec into discovered CI, including failure/retry.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const ownedContexts: BrowserContext[] = []
test.afterEach(async ({ context }, info) => {
  for (const owned of [context, ...ownedContexts.splice(0)]) {
    for (const page of owned.pages()) await closeCredentialPage(page, info)
    if (owned !== context) await owned.close()
  }
})

async function safeApi(path: string, body?: object, credential?: string) {
  try {
    return await directApi(path, body, credential)
  } catch {
    throw new Error('Adoption fixture request failed; credential diagnostics omitted')
  }
}
async function keyStatus(secret: string, organizationId: string) {
  try {
    return (
      await fetch(
        `http://127.0.0.1:${activeTarget().ports.api}/api/v1/organizations/${organizationId}`,
        {
          headers: { authorization: `Bearer ${secret}` },
          redirect: 'error',
        }
      )
    ).status
  } catch {
    throw new Error('Adoption key probe failed; credential diagnostics omitted')
  }
}
const count = (query: string, vars: Record<string, string>) =>
  Number(guardedSql(query, vars).trim())
async function memberAction(
  page: Page,
  messages: Record<string, string>,
  email: string,
  action: string
) {
  const button = page
    .getByRole('button', { name: messages.actionFor!.replace('{name}', email), exact: true })
    .filter({ visible: true })
  await expect(button).toBeEnabled()
  await button.click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

test('ready adoption connects organization selection, roles, invitations, own keys and permanent member removal', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(240000)
  const target = activeTarget()
  const ui = organizationUi()
  const messages = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const creation = messages.organizationCreation
  const members = messages.organizationMembers
  const roles = messages.organizationRoles
  const invitation = messages.organizationInvitations
  const removal = messages.memberRemoval
  const email = uniqueEmail('adopter-owner')
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { origin: target.origins.product },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  const owner = await safeApi('auth/login', { email, password: TEST_PASSWORD })
  expect(
    count('SELECT count(*) FROM core.org_members WHERE "userId"=:\'actor\';', {
      actor: owner.user.id,
    })
  ).toBe(0)
  await page.goto(ui.path())
  await expect(page.getByText(ui.text('emptyTitle'), { exact: true })).toBeVisible()
  async function createOrganization(name: string) {
    await page.getByRole('button', { name: creation.create, exact: true }).click()
    await page.getByLabel(creation.name, { exact: true }).fill(name)
    const reply = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/api/product-access/organizations')
    )
    await page.getByRole('button', { name: creation.create, exact: true }).click()
    const response = await reply
    expect(response.status()).toBe(201)
    const result = await response.json()
    await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
    return result.data.id as string
  }
  const org = await createOrganization('Adopter Alpha')
  await page.goto(ui.path())
  await expect(page).toHaveURL(new RegExp(`${ui.path(`/${org}`)}$`))
  await page.getByRole('link', { name: ui.text('all'), exact: true }).click()
  await expect(page).toHaveURL(/view=list/)
  await expect(page.getByRole('link', { name: ui.open('Adopter Alpha') })).toBeVisible()
  const second = await createOrganization('Adopter Beta')
  await page.goto(ui.path())
  await expect(page.getByRole('link', { name: ui.open('Adopter Alpha') })).toBeVisible()
  await expect(page.getByRole('link', { name: ui.open('Adopter Beta') })).toBeVisible()
  await page.getByRole('link', { name: ui.open('Adopter Beta') }).click()
  await expect(
    page.getByRole('heading', { name: 'Adopter Beta', exact: true, level: 1 })
  ).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(ui.path(`/${second}`))
  await page.goto(ui.path(`/${org}`))
  await expect(page.getByRole('heading', { name: 'Adopter Beta', exact: true })).toHaveCount(0)

  // A real separate account/organization provides the foreign target, not a random missing ID.
  const outsider = await safeApi('auth/register', {
    email: uniqueEmail('adopter-foreign'),
    password: TEST_PASSWORD,
  })
  const foreign = await safeApi('organizations', { name: 'Foreign tenant' }, outsider.accessToken)
  expect([403, 404].includes((await page.goto(ui.path(`/${foreign.id}/members`)))!.status())).toBe(
    true
  )
  const bootstrap = await context.request.get('/api/product-access/bootstrap')
  const { binding } = await bootstrap.json()
  const headers = { origin: target.origins.product, 'X-AMCore-Context-Session': binding }
  const beforeForeign = count(
    'SELECT count(*) FROM core.audit_log WHERE "organizationId"=:\'org\';',
    { org: foreign.id }
  )
  expect(
    [403, 404].includes(
      (
        await context.request.get(`/api/product-access/organizations/${foreign.id}/members`, {
          headers,
        })
      ).status()
    )
  ).toBe(true)
  expect(
    [403, 404].includes(
      (
        await context.request.patch(
          `/api/product-access/organizations/${foreign.id}/members/${outsider.user.id}/roles`,
          {
            headers,
            data: {
              expectedMemberId: guardedSql(
                'SELECT id FROM core.org_members WHERE "organizationId"=:\'org\';',
                { org: foreign.id }
              ).trim(),
              expectedAclVersion: 0,
              roleIds: [],
            },
          }
        )
      ).status()
    )
  ).toBe(true)
  expect(
    count('SELECT count(*) FROM core.audit_log WHERE "organizationId"=:\'org\';', {
      org: foreign.id,
    })
  ).toBe(beforeForeign)

  const colleagueEmail = uniqueEmail('adopter-second-admin')
  const colleague = await safeApi('auth/register', {
    email: colleagueEmail,
    password: TEST_PASSWORD,
  })
  const membership = `c${randomUUID().replaceAll('-', '').slice(0, 24)}`
  guardedSql(
    `INSERT INTO core.org_members(id,"userId","organizationId") VALUES (:'member',:'user',:'org');
    INSERT INTO core.member_roles(id,"memberId","roleId") SELECT :'link',:'member',id FROM core.roles WHERE name='ADMIN' AND "isSystem"=true AND "organizationId" IS NULL;
    UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
    {
      member: membership,
      user: colleague.user.id,
      org,
      link: `c${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    }
  )
  await page.goto(ui.path(`/${org}`))
  const nav = page.getByRole('navigation', { name: messages.organizationNav.sections })
  await nav.getByRole('link', { name: messages.organizationNav.roles, exact: true }).click()
  await page.getByRole('button', { name: roles.create, exact: true }).click()
  await page.getByLabel(roles.nameLabel, { exact: true }).fill('Adopter reader')
  await page.getByRole('button', { name: roles.createSubmit, exact: true }).click()
  await expect(page).toHaveURL(/\/roles\/[A-Za-z0-9_-]+$/)
  const roleId = new URL(page.url()).pathname.split('/').at(-1)!
  const group = page.getByRole('group', {
    name: new RegExp(roles.capabilities.organizationRead.label),
  })
  await group.getByRole('checkbox', { name: roles.levels.all, exact: true }).check()
  await page.getByRole('button', { name: roles.save, exact: true }).click()
  await expect(page.getByText(roles.saved, { exact: true })).toBeVisible()
  await nav.getByRole('link', { name: messages.organizationNav.members, exact: true }).click()
  await memberAction(page, members, colleagueEmail, members.edit)
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: 'Adopter reader', exact: true })
    .check()
  await page.getByRole('dialog').getByRole('button', { name: members.save, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(
    count(
      'SELECT count(*) FROM core.member_roles WHERE "memberId"=:\'member\' AND "roleId"=:\'role\';',
      { member: membership, role: roleId }
    )
  ).toBe(1)
  const audit = JSON.parse(
    guardedSql(
      `SELECT json_build_object('actor',"actorId",'target',"targetId",'metadata',metadata) FROM core.audit_log
    WHERE action='org.member_roles_changed' AND "organizationId"=:'org' AND "targetId"=:'user' ORDER BY "createdAt" DESC LIMIT 1;`,
      { org, user: colleague.user.id }
    ).trim()
  )
  expect(audit).toMatchObject({
    actor: owner.user.id,
    target: colleague.user.id,
    metadata: {
      actorCredentialType: 'jwt',
      memberId: membership,
      addedCount: 1,
      removedCount: 0,
      source: 'replace',
    },
  })
  await memberAction(page, members, colleagueEmail, members.access)
  await expect(page.getByRole('dialog').getByRole('heading').first()).toBeVisible()
  await page.keyboard.press('Escape')

  await nav.getByRole('link', { name: messages.organizationNav.invitations, exact: true }).click()
  await page.getByRole('button', { name: invitation.invite, exact: true }).click()
  const recipient = uniqueEmail('adopter-invite')
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: invitation.email, exact: true })
    .fill(recipient)
  const issued = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/invites')
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: invitation.invite, exact: true })
    .click()
  expect((await issued).status()).toBe(202)
  const invitationRow = page.getByRole('row').filter({ hasText: recipient })
  await expect(invitationRow).toBeVisible()
  await invitationRow
    .getByRole('button', {
      name: invitation.actionFor
        .replace('{action}', invitation.actions)
        .replace('{email}', recipient),
      exact: true,
    })
    .click()
  await page
    .getByRole('menuitem', {
      name: invitation.actionFor
        .replace('{action}', invitation.revoke)
        .replace('{email}', recipient),
      exact: true,
    })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: invitation.revoke, exact: true })
    .click()
  await expect(invitationRow).toHaveCount(0)

  // This context is registered for failure-DOM cleanup before its first credential-bearing step.
  const staff = await browser.newContext()
  ownedContexts.push(staff)
  expect(
    (
      await staff.request.post(`${target.origins.product}/api/auth/login`, {
        headers: { origin: target.origins.product },
        data: { email: colleagueEmail, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(200)
  const staffPage = await staff.newPage()
  await staffPage.goto(
    localizedFrontendUrl(
      target.origins.product,
      DEFAULT_LOCALE,
      `${productAdminPath('/settings/api-keys')}?organizationId=${org}`
    )
  )
  const keys = messages.ownApiKeys
  await staffPage.getByRole('button', { name: keys.create, exact: true }).click()
  const dialog = staffPage.locator('[data-slot=dialog-content]')
  await dialog.locator('button').filter({ hasText: keys.selectOrganization }).click()
  await staffPage
    .locator(`div[aria-label="${keys.selectOrganization}"]`)
    .getByRole('option')
    .filter({ hasText: 'Adopter Alpha' })
    .click()
  await dialog.getByLabel(keys.name, { exact: true }).fill('Adopter export')
  await dialog
    .getByRole('checkbox', { name: roles.capabilities.organizationRead.label, exact: true })
    .check()
  await dialog.getByRole('button', { name: keys.create, exact: true }).click()
  const input = dialog.getByRole('textbox', { name: keys.secret, exact: true })
  await expect.poll(async () => (await input.inputValue()).startsWith('amcore_live_')).toBe(true)
  const secret = await input.inputValue()
  expect(await keyStatus(secret, org)).toBe(200)
  await dialog.getByRole('button', { name: keys.saved, exact: true }).click()
  await staffPage.reload()
  expect(await staffPage.content().then((html) => html.includes(secret))).toBe(false)

  await page.goto(ui.path(`/${org}/members`))
  await memberAction(page, members, colleagueEmail, members.apiKeys)
  await expect(page.getByRole('dialog').getByText('Adopter export', { exact: true })).toBeVisible()
  expect(await page.content().then((html) => html.includes(secret))).toBe(false)
  await page.keyboard.press('Escape')
  let deletes = 0
  page.on('request', (r) => {
    if (r.method() === 'DELETE' && r.url().includes('/members/')) deletes++
  })
  await memberAction(page, members, colleagueEmail, members.remove)
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: removal.cancel, exact: true })
    .click()
  expect(deletes).toBe(0)
  await memberAction(page, members, colleagueEmail, members.remove)
  await expect(page.getByRole('alertdialog')).toContainText(removal.warning)
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: removal.confirm, exact: true })
    .click()
  await expect(page.getByText(removal.success, { exact: true })).toBeVisible()
  expect(deletes).toBe(1)
  expect(
    count("SELECT count(*) FROM core.org_members WHERE id=:'member';", { member: membership })
  ).toBe(0)
  expect(
    count(
      'SELECT count(*) FROM core.api_keys WHERE "userId"=:\'user\' AND "organizationId"=:\'org\' AND "revokedAt" IS NOT NULL AND "keyHash" IS NULL AND salt IS NULL;',
      { user: colleague.user.id, org }
    )
  ).toBe(1)
  expect(await keyStatus(secret, org)).toBe(401)
  const removalAudit = JSON.parse(
    guardedSql(
      `SELECT metadata FROM core.audit_log WHERE action='organization.member_removed' AND "organizationId"=:'org' AND "targetId"=:'user';`,
      { org, user: colleague.user.id }
    ).trim()
  )
  expect(removalAudit).toMatchObject({
    memberId: membership,
    selectedKeyCount: 1,
    revokedKeyCount: 1,
    reason: 'membership_removed',
  })
  const committed = count(
    "SELECT count(*) FROM core.audit_log WHERE action='organization.member_removed' AND \"organizationId\"=:'org';",
    { org }
  )
  await page.reload()
  expect(
    count(
      "SELECT count(*) FROM core.audit_log WHERE action='organization.member_removed' AND \"organizationId\"=:'org';",
      { org }
    )
  ).toBe(committed)
  await memberAction(page, members, email, members.remove)
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: removal.confirm, exact: true })
    .click()
  await expect(page.getByText(removal.lastAdmin, { exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
})
