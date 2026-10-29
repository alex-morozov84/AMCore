import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'

test('member removal: cancellation, last ADMIN, lost acknowledgment, narrow RU and own removal', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
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
    INSERT INTO core.member_roles (id,"memberId","roleId") SELECT :'link',:'member',id FROM core.roles WHERE name='MEMBER' AND "isSystem"=true;
    UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
    {
      member: memberId,
      user: colleague.user.id,
      org: org.id,
      link: `c${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    }
  )
  let catalogue: Record<string, Record<string, string>>
  const visit = async (locale: (typeof SUPPORTED_LOCALES)[number]) => {
    catalogue = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    )
    await page.goto(
      new URL(
        localizedFrontendUrl(target.origins.product, locale, `organizations/${org.id}/members`)
      ).pathname
    )
    await expect(
      page.getByRole('heading', { name: 'Removal browser proof', exact: true })
    ).toBeVisible()
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
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  for (const locale of SUPPORTED_LOCALES) {
    await visit(locale)
    await open(colleagueEmail)
    const dialog = page.getByRole('alertdialog')
    const t = catalogue!.memberRemoval!
    await expect(dialog).toContainText(t.warning!)
    await expect(dialog.getByRole('button', { name: t.cancel, exact: true })).toBeFocused()
    await page.setViewportSize({ width: 320, height: 320 })
    await expect(dialog.getByRole('button', { name: t.confirm, exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expectNoAxeViolations(page)
    await dialog.getByRole('button', { name: t.cancel, exact: true }).click()
    await expect(
      page.getByRole('heading', { name: catalogue!.organizationMembers!.title, exact: true })
    ).toBeFocused()
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(email)
    await expect(page.getByRole('alertdialog')).toContainText(t.selfWarning!)
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t.confirm, exact: true })
      .click()
    await expect(page.getByText(t.lastAdmin!, { exact: true })).toBeVisible()
  }
  const t = catalogue!.memberRemoval!
  // Let the real request commit, then lose only the browser acknowledgment.
  await page.route(
    '**/api/product-access/organizations/*/members/*?expectedMemberId=*',
    async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    }
  )
  await open(colleagueEmail)
  await page.getByRole('alertdialog').getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(page.getByText(t.unknown!, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: t.check, exact: true }).click()
  await expect(page.getByText(t.unavailable!, { exact: true })).toBeVisible()
  await page.unroute('**/api/product-access/organizations/*/members/*?expectedMemberId=*')
  // A second administrator permits self removal; reload deliberately leaves local notices behind.
  const replacementId = `c${randomUUID().replaceAll('-', '').slice(0, 24)}`
  guardedSql(
    `INSERT INTO core.org_members (id,"userId","organizationId") VALUES (:'member',:'user',:'org');
    INSERT INTO core.member_roles (id,"memberId","roleId") SELECT :'link',:'member',id FROM core.roles WHERE name='ADMIN' AND "isSystem"=true;
    UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
    {
      member: replacementId,
      user: colleague.user.id,
      org: org.id,
      link: `c${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    }
  )
  await page.reload()
  await open(email)
  await page.getByRole('alertdialog').getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(page.getByText(t.selfSuccessTitle!, { exact: true })).toBeVisible()
  await expect(page.getByText(t.selfSuccess!, { exact: true })).toBeVisible()
  await expect(page.getByText(t.refreshFailed!, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: t.check, exact: true })).toHaveCount(0)
  await expect(page.getByText(catalogue!.errors!.UNKNOWN_ERROR!, { exact: true })).toHaveCount(0)
  await expect(page.getByText(catalogue!.errors!.RESOURCE_NOT_FOUND!, { exact: true })).toHaveCount(
    0
  )
  await expect(
    page.getByPlaceholder(catalogue!.organizationMembers!.memberSearchPlaceholder!)
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: catalogue!.organizationMembers!.retry, exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: t.organizations, exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
  expect(failures).toEqual([])
})
