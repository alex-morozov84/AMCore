import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

// Real BFF, real API, real browser: the ready roles list and role page end to end. Uses only the
// active managed test stand and an account created by this test.
test('roles: create, edit, protect an unsaved draft, confirm full control and delete', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const catalogue = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const t = catalogue.organizationRoles
  const nav = catalogue.organizationNav
  const like = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const email = uniqueEmail('roles-ui')
  const registration = await context.request.post('/api/auth/register', {
    headers: { origin: target.origins.product },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const org = await directApi('organizations', { name: 'Roles browser proof' }, login.accessToken)
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.name))
  const authorization: string[] = []
  page.on('request', (request) => {
    if (request.headers()['authorization']) authorization.push(request.url())
  })

  // List: built-in roles apart, an empty table with its own message.
  await page.goto(
    new URL(
      localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, `organizations/${org.id}/roles`)
    ).pathname
  )
  await expect(page.getByRole('region', { name: t.builtinTitle })).toBeVisible()
  await expect(page.getByText(t.customEmpty)).toBeVisible()
  await expectNoAxeViolations(page)

  // Create -> 201 -> the role page opens.
  await page.getByRole('button', { name: t.create }).click()
  await page.getByLabel(t.nameLabel).fill('Browser role')
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/role-definitions')
  )
  await page.getByRole('button', { name: t.createSubmit }).click()
  expect((await created).status()).toBe(201)
  await expect(page).toHaveURL(/\/roles\/[A-Za-z0-9_-]+$/)
  await expect(page.getByRole('heading', { name: t.capabilitiesTitle })).toBeVisible()
  const group = (name: RegExp) => page.getByRole('group', { name })
  const level = (name: RegExp, label: string) => group(name).getByRole('checkbox', { name: label })

  // Save a preset -> 200, then a full reload shows it from the server.
  await level(like(t.capabilities.organizationRead.label), t.levels.all).click()
  await expect(page.getByText(t.unsaved)).toBeVisible()
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/role-definitions/')
  )
  await page.getByRole('button', { name: t.save }).click()
  expect((await saved).status()).toBe(200)
  await expect(page.getByText(t.saved)).toBeVisible()
  await page.reload()
  await expect(level(like(t.capabilities.organizationRead.label), t.levels.all)).toBeChecked()
  await expectNoAxeViolations(page)

  // An unsaved draft is protected when following a link; staying keeps it.
  await level(like(t.capabilities.organizationUpdate.label), t.levels.own).click()
  await page
    .getByRole('navigation', { name: nav.sections })
    .getByRole('link', { name: nav.members })
    .click()
  await expect(page.getByRole('alertdialog', { name: t.leaveTitle })).toBeVisible()
  await page.getByRole('button', { name: t.leaveStay }).click()
  await expect(level(like(t.capabilities.organizationUpdate.label), t.levels.own)).toBeChecked()
  await page.getByRole('button', { name: t.discard }).click()
  await expect(level(like(t.capabilities.organizationUpdate.label), t.levels.own)).not.toBeChecked()

  // Full control needs an explicit confirmation; cancelling sends nothing.
  await level(like(t.capabilities.teamAccessManagement.label), t.levels.all).click()
  let writes = 0
  page.on('request', (r) => r.method() === 'PATCH' && (writes += 1))
  await page.getByRole('button', { name: t.save }).click()
  await expect(page.getByRole('alertdialog', { name: t.fullControlTitle })).toBeVisible()
  await page.getByRole('button', { name: t.cancel }).click()
  expect(writes).toBe(0)
  await page.getByRole('button', { name: t.save }).click()
  await page.getByRole('button', { name: t.fullControlConfirm }).click()
  await expect(page.getByText(t.saved)).toBeVisible()

  // Delete names the loaded numbers and needs an acknowledgment; then the list is empty again.
  await page.getByRole('button', { name: t.delete }).click()
  const dialog = page.getByRole('dialog', { name: t.deleteTitle })
  // Nothing is affected, so no acknowledgment is asked for.
  await expect(dialog).toContainText(t.deleteNone)
  await expect(dialog.getByRole('checkbox', { name: t.deleteAck })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: t.deleteConfirm })).toBeEnabled()
  const deleted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/deletion')
  )
  await dialog.getByRole('button', { name: t.deleteConfirm }).click()
  expect((await deleted).status()).toBe(200)
  await expect(page).toHaveURL(/\/roles$/)
  await expect(page.getByText(t.customEmpty)).toBeVisible()

  expect(failures).toEqual([])
  expect(authorization).toEqual([])
})
