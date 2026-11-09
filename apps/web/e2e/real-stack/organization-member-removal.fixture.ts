import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type CatalogueLocale, localizedFrontendUrl } from '@amcore/shared'
import { type BrowserContext, expect, type Page } from '@playwright/test'

import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'

/** Every caller owns a fresh organization and accounts; no serial cross-test state. */
export async function removalFixture(page: Page, context: BrowserContext, colleagueAdmin = false) {
  const target = activeTarget()
  const email = uniqueEmail('remove-admin')
  expect(
    (
      await browserCredentialRequest(context.request, '/api/auth/register', {
        headers: { origin: target.origins.product },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  const admin = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const org = await directApi('organizations', { name: 'Removal browser proof' }, admin.accessToken)
  const colleagueEmail = uniqueEmail('remove-colleague')
  const colleague = await directApi('auth/register', {
    email: colleagueEmail,
    password: TEST_PASSWORD,
  })
  const memberId = `c${randomUUID().replaceAll('-', '').slice(0, 24)}`
  guardedSql(
    `INSERT INTO core.org_members (id,"userId","organizationId") VALUES (:'member',:'user',:'org');
    INSERT INTO core.member_roles (id,"memberId","roleId") SELECT :'link',:'member',id FROM core.roles WHERE name=:'role' AND "isSystem"=true;
    UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
    {
      member: memberId,
      user: colleague.user.id,
      org: org.id,
      role: colleagueAdmin ? 'ADMIN' : 'MEMBER',
      link: `c${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    }
  )
  let catalogue: Record<string, Record<string, string>>
  const readCatalogue = (locale: CatalogueLocale): Record<string, Record<string, string>> =>
    JSON.parse(readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8'))
  const visit = async (locale: CatalogueLocale) => {
    catalogue = readCatalogue(locale)
    await page.goto(
      new URL(
        localizedFrontendUrl(target.origins.product, locale, `organizations/${org.id}/members`)
      ).pathname
    )
    await expect(
      page.getByRole('heading', { name: 'Removal browser proof', exact: true })
    ).toBeVisible()
    return catalogue
  }
  const open = async (person: string) => {
    const trigger = page
      .getByRole('button', {
        name: catalogue.organizationMembers!.actionFor!.replace('{name}', person),
        exact: true,
      })
      .filter({ visible: true })
    await expect(trigger).toBeEnabled()
    await trigger.click()
    await page
      .getByRole('menuitem', { name: catalogue.organizationMembers!.remove, exact: true })
      .click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
  }
  const storedMembers = () =>
    guardedSql(
      'SELECT id FROM core.org_members WHERE "organizationId"=:\'org\' AND "userId"=:\'user\' ORDER BY id;',
      { org: org.id, user: colleague.user.id }
    ).trim()
  const storedOrganizationMembers = () =>
    guardedSql(
      'SELECT id, "userId" FROM core.org_members WHERE "organizationId"=:\'org\' ORDER BY id;',
      { org: org.id }
    ).trim()
  return {
    email,
    admin,
    org,
    colleagueEmail,
    memberId,
    visit,
    open,
    storedMembers,
    storedOrganizationMembers,
    readCatalogue,
    target,
  }
}
