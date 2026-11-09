import { DEFAULT_LOCALE, SERVED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { removalFixture } from './organization-member-removal.fixture'

test('last ADMIN refusal preserves membership and authority; cancellation restores focus', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const fixture = await removalFixture(page, context)
  // Keep one full-page narrow smoke for the longest loaded warning catalogue.
  const warningLength = (locale: (typeof SERVED_LOCALES)[number]) => {
    const text = fixture.readCatalogue(locale).memberRemoval!
    return (text.warning! + text.selfWarning!).length
  }
  const locale = [...SERVED_LOCALES].sort((a, b) => warningLength(b) - warningLength(a))[0]!
  const catalogue = await fixture.visit(locale)
  const t = catalogue.memberRemoval!
  await fixture.open(fixture.colleagueEmail)
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(t.warning!)
  await expect(dialog.getByRole('button', { name: t.cancel, exact: true })).toBeFocused()
  await page.setViewportSize({ width: 320, height: 320 })
  await expectNoAxeViolations(page)
  await expect(dialog.getByRole('button', { name: t.confirm, exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await dialog.getByRole('button', { name: t.cancel, exact: true }).click()
  await expect(
    page.getByRole('heading', { name: catalogue.organizationMembers!.title, exact: true })
  ).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 900 })
  const before = fixture.storedOrganizationMembers()
  await fixture.open(fixture.email)
  await expect(page.getByRole('alertdialog')).toContainText(t.selfWarning!)
  await page.getByRole('alertdialog').getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(page.getByText(t.lastAdmin!, { exact: true })).toBeVisible()
  expect(fixture.storedOrganizationMembers()).toBe(before)
  await fixture.visit(locale)
  await fixture.open(fixture.colleagueEmail)
  await expect(
    page.getByRole('alertdialog').getByRole('button', { name: t.confirm, exact: true })
  ).toBeEnabled()
  await page.getByRole('alertdialog').getByRole('button', { name: t.cancel, exact: true }).click()
})

test('lost removal acknowledgment inspects committed state without replaying DELETE', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const fixture = await removalFixture(page, context)
  const catalogue = await fixture.visit(DEFAULT_LOCALE)
  const t = catalogue.memberRemoval!
  expect(fixture.storedMembers()).toBe(fixture.memberId)
  let deletes = 0
  await page.route(
    '**/api/product-access/organizations/*/members/*?expectedMemberId=*',
    async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue()
      deletes++
      expect(new URL(route.request().url()).searchParams.get('expectedMemberId')).toBe(
        fixture.memberId
      )
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('failed')
    }
  )
  await fixture.open(fixture.colleagueEmail)
  await page.getByRole('alertdialog').getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(page.getByText(t.unknown!, { exact: true })).toBeVisible()
  expect(fixture.storedMembers()).toBe('')
  expect(deletes).toBe(1)
  await page.getByRole('button', { name: t.check, exact: true }).click()
  await expect(page.getByText(t.unavailable!, { exact: true })).toBeVisible()
  expect(deletes).toBe(1)
  expect(fixture.storedMembers()).toBe('')
})

test('self removal with another ADMIN preserves success and denies old actor access', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const fixture = await removalFixture(page, context, true)
  const catalogue = await fixture.visit(DEFAULT_LOCALE)
  const t = catalogue.memberRemoval!
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await fixture.open(fixture.email)
  await page.getByRole('alertdialog').getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(page.getByText(t.selfSuccessTitle!, { exact: true })).toBeVisible()
  await expect(page.getByText(t.selfSuccess!, { exact: true })).toBeVisible()
  for (const text of [
    t.refreshFailed!,
    catalogue.errors!.UNKNOWN_ERROR!,
    catalogue.errors!.RESOURCE_NOT_FOUND!,
  ]) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: t.check, exact: true })).toHaveCount(0)
  await expect(
    page.getByPlaceholder(catalogue.organizationMembers!.memberSearchPlaceholder!)
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: catalogue.organizationMembers!.retry, exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: t.organizations, exact: true })).toBeVisible()
  const oldAccess = await fetch(
    `http://127.0.0.1:${fixture.target.ports.api}/api/v1/organizations/${fixture.org.id}/members`,
    {
      headers: { authorization: `Bearer ${fixture.admin.accessToken}` },
      redirect: 'error',
    }
  )
  expect(oldAccess.status).toBe(403)
  await expectNoAxeViolations(page)
  expect(failures).toEqual([])
})
