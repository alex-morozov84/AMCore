import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

// The row actions live behind one menu trigger; the visible trigger belongs to the current layout.
const rowMenu = (page: Page, t: Record<string, string>, email: string) =>
  page
    .getByRole('button', { name: t.actionFor!.replace('{name}', email), exact: true })
    .filter({ visible: true })
async function openEdit(page: Page, t: Record<string, string>, email: string) {
  const item = page.getByRole('menuitem', { name: t.edit, exact: true })
  // A list refresh can close an open menu; reopen until the item is really there.
  await expect(async () => {
    await expect(rowMenu(page, t, email)).toBeEnabled()
    if (!(await item.isVisible())) await rowMenu(page, t, email).click()
    await expect(item).toBeVisible({ timeout: 2000 })
  }).toPass()
  await item.click()
}

// Uses only the active managed test stand and an account created by this test.
test('members: real BFF, complete draft, Enter filtering, self-warning, responsive EN/RU', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const email = uniqueEmail('member-roles')
  const registration = await context.request.post('/api/auth/register', {
    headers: { origin: target.origins.product },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const org = await directApi(
    'organizations',
    { name: 'Member roles browser proof' },
    login.accessToken
  )
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.name))
  for (const locale of SUPPORTED_LOCALES) {
    const t = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    ).organizationMembers
    await page.goto(
      new URL(
        localizedFrontendUrl(target.origins.product, locale, `organizations/${org.id}/members`)
      ).pathname
    )
    await expect(
      page.getByRole('heading', { name: 'Member roles browser proof', exact: true })
    ).toBeVisible()
    await expect(rowMenu(page, t, email)).toBeEnabled()
    const listSearch = page.getByRole('textbox', { name: t.search })
    await listSearch.fill(email)
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible()
    await openEdit(page, t, email)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('checkbox', { name: 'ADMIN', exact: true })).toBeChecked()
    const member = dialog.getByRole('checkbox', { name: 'MEMBER', exact: true })
    await member.check()
    const search = dialog.getByRole('textbox', { name: t.search })
    await search.fill('VIEWER')
    await search.press('Enter')
    await expect(dialog.getByRole('checkbox', { name: 'VIEWER', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: t.save, exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: t.clear, exact: true }).click()
    await expect(member).toBeChecked()
    const warning = dialog.getByRole('checkbox', { name: t.selfWarning })
    await warning.check()
    const ack = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(`/members/${login.user.id}/roles`)
    )
    await dialog.getByRole('button', { name: t.save, exact: true }).click()
    expect((await ack).status()).toBe(200)
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: t.title })).toBeFocused()
    const editAction = rowMenu(page, t, email)
    await expect(editAction).toBeEnabled()
    await expect
      .poll(() =>
        editAction.evaluate((el) => el.getAnimations().every((a) => a.playState !== 'running'))
      )
      .toBe(true)
    await expectNoAxeViolations(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(rowMenu(page, t, email)).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await expectNoAxeViolations(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    // Restore membership roles through this same UI for the next locale.
    await openEdit(page, t, email)
    await dialog.getByRole('checkbox', { name: 'MEMBER', exact: true }).uncheck()
    await dialog.getByRole('checkbox', { name: t.selfWarning }).check()
    await dialog.getByRole('button', { name: t.save, exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  expect(failures).toEqual([])
})
