import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

// Real BFF, real API, real browser: the access explanation of a member who holds the built-in ADMIN
// role and a custom role that denies editing the name. Uses only the active managed test stand.
test('member access: roles, decisions, a veto with its cause, a failed read and recovery', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const catalogue = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const t = catalogue.memberAccess
  const capabilities = catalogue.organizationRoles.capabilities
  const email = uniqueEmail('member-access')
  const registration = await context.request.post('/api/auth/register', {
    headers: { origin: target.origins.product },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const org = await directApi('organizations', { name: 'Access browser proof' }, login.accessToken)
  const id = (label: string) => `c${randomUUID().replaceAll('-', '').slice(0, 24)}${label}`
  guardedSql(
    `INSERT INTO core.roles (id, name, "organizationId", "isSystem") VALUES (:'role', 'Auditor', :'org', false);
 INSERT INTO core.permissions (id, action, subject, fields, inverted, "organizationId") VALUES (:'perm', 'update', 'Organization', ARRAY['name'], true, :'org');
 INSERT INTO core.role_permissions ("roleId", "permissionId") VALUES (:'role', :'perm');
 INSERT INTO core.member_roles (id, "memberId", "roleId") SELECT :'link', id, :'role' FROM core.org_members WHERE "userId" = :'user' AND "organizationId" = :'org';
 UPDATE core.organizations SET "aclVersion" = "aclVersion" + 1 WHERE id = :'org';`,
    {
      org: org.id,
      user: login.user.id,
      role: id('r'),
      perm: id('p'),
      link: id('l'),
    }
  )
  const openAccess = async () => {
    await page
      .getByRole('button', {
        name: catalogue.organizationMembers.actionFor.replace('{name}', email),
      })
      .filter({ visible: true })
      .click()
    await page
      .getByRole('menuitem', { name: catalogue.organizationMembers.access, exact: true })
      .click()
  }
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.name))
  await page.goto(
    new URL(
      localizedFrontendUrl(
        target.origins.product,
        DEFAULT_LOCALE,
        `organizations/${org.id}/members`
      )
    ).pathname
  )
  await openAccess()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: t.title })).toBeVisible()
  await expect(dialog.getByText('Auditor').first()).toBeVisible()
  await expect(dialog.getByText('ADMIN').first()).toBeVisible()
  await expect(dialog.getByText(capabilities.teamAccessManagement.label)).toBeVisible()
  await expect(dialog.getByText(t.baselineNote)).toBeVisible()
  // The custom role vetoes editing the name; the row says who would allow it and who blocks it.
  const nameRow = dialog
    .getByRole('listitem')
    .filter({ hasText: capabilities.organizationUpdate.label })
    .filter({ hasText: t.fields.name })
  await expect(nameRow).toContainText(t.blocked)
  await expect(nameRow).toContainText('Auditor')
  await nameRow.getByText(t.whyTitle).click()
  await expect(nameRow).toContainText(t.status.vetoes)
  await expect(dialog.getByText(t.vetoed)).toBeVisible()
  await expectNoAxeViolations(page)

  // A failed read hides the answer and offers a retry; the next successful read restores it.
  await dialog.getByRole('button', { name: t.close }).click()
  await expect(dialog).toHaveCount(0)
  await page.route('**/api/product-access/organizations/*/members/*/access', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 503, errorCode: 'ROLE_ACCESS_UNAVAILABLE', message: 'x' }),
    })
  )
  await openAccess()
  await expect(page.getByText(t.unavailable)).toBeVisible()
  await expect(page.getByText(capabilities.teamAccessManagement.label)).toHaveCount(0)
  await page.unroute('**/api/product-access/organizations/*/members/*/access')
  await page.getByRole('button', { name: t.retry }).click()
  await expect(page.getByText(capabilities.teamAccessManagement.label)).toBeVisible()
  expect(failures).toEqual([])
})
