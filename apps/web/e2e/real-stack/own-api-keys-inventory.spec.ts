import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { closeCredentialPage } from '../shared/credential-artifacts'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.afterEach(({ page }, info) => closeCredentialPage(page, info))
test('personal navigation, full-list filters, details, URL history and independent creation target', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const messages = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const t = messages.ownApiKeys
  const email = uniqueEmail('key-inventory')
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { origin: target.origins.product },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const first = await directApi('organizations', { name: 'Alpha keys' }, login.accessToken)
  const second = await directApi('organizations', { name: 'Beta keys' }, login.accessToken)
  guardedSql(
    `INSERT INTO core.api_keys (id,name,"shortToken","keyHash",salt,scopes,"userId","organizationId","expiresAt","createdAt")
    SELECT 'c'||substr(md5(:'user'||n::text),1,24), 'Inventory '||lpad(n::text,2,'0'),
    :'user'||n::text, 'not-an-authenticating-verifier', 'fixture', ARRAY['read:Organization'], :'user', :'first', now()+interval '30 days', now()-make_interval(mins=>n)
    FROM generate_series(1,24) n;
    INSERT INTO core.api_keys (id,name,"shortToken","keyHash",salt,scopes,"userId","organizationId","expiresAt")
    VALUES ('c'||substr(md5(:'user'||'beta'),1,24),'Inventory 24',:'user'||'beta','not-an-authenticating-verifier','fixture',ARRAY['read:Organization'],:'user',:'second',NULL);`,
    { user: login.user.id, first: first.id, second: second.id }
  )
  const path = new URL(
    localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, 'settings/api-keys')
  ).pathname
  await page.goto(path)
  await page.bringToFront()
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByRole('button', { name: t.next, exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('row').filter({ hasText: 'Inventory 24' })).toHaveCount(1)
  await page.getByRole('textbox', { name: t.search, exact: true }).fill('Inventory 24')
  await page.getByRole('textbox', { name: t.search, exact: true }).press('Enter')
  await expect(page.getByRole('row').filter({ hasText: 'Inventory 24' })).toHaveCount(2)
  await expect(page).not.toHaveURL(/page=2/)
  await page.reload()
  await expect(page.getByRole('textbox', { name: t.search, exact: true })).toHaveValue(
    'Inventory 24'
  )
  const search = page.getByRole('textbox', { name: t.search, exact: true })
  const organization = page.locator('button').filter({ hasText: t.allOrganizations })
  const searchBox = await search.boundingBox()
  const organizationBox = await organization.boundingBox()
  expect(searchBox && organizationBox && Math.abs(searchBox.y - organizationBox.y)).toBeLessThan(2)
  await organization.click()
  const picker = page.locator(`div[aria-label="${t.selectOrganization}"]`)
  await picker.getByLabel(t.organizationSearch, { exact: true }).fill('Beta keys')
  await expect(picker.getByRole('option')).toHaveCount(2)
  const optionInput = picker.getByLabel(t.organizationSearch, { exact: true })
  for (let step = 0; step < 3; step++) {
    await optionInput.press('ArrowDown')
    const active = await optionInput.getAttribute('aria-activedescendant')
    if (active && (await page.locator(`[id="${active}"]`).textContent())?.includes('Beta keys'))
      break
  }
  const highlighted = await optionInput.getAttribute('aria-activedescendant')
  expect(highlighted).toBeTruthy()
  await expect(page.locator(`[id="${highlighted}"]`)).toContainText('Beta keys')
  await optionInput.press('Enter')
  const row = page.getByRole('row').filter({ hasText: 'Inventory 24' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Beta keys')
  await row.getByRole('button', { name: 'Inventory 24', exact: true }).click()
  const details = page.locator('[data-slot=dialog-content]')
  await expect(details.getByRole('heading', { name: 'Inventory 24', exact: true })).toBeVisible()
  await expect(details.getByText(t.noExpiry, { exact: true })).toBeVisible()
  await expect(
    details.getByText(messages.organizationRoles.capabilities.organizationRead.label, {
      exact: true,
    })
  ).toBeVisible()
  await expectNoAxeViolations(page)
  await details.getByRole('button', { name: t.close, exact: true }).click()
  await page.getByRole('textbox', { name: t.search, exact: true }).fill('no matching key')
  await page.getByRole('textbox', { name: t.search, exact: true }).press('Enter')
  await expect(page.getByText(t.noMatches, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: t.reset, exact: true }).click()
  await expect(page.getByRole('row')).toHaveCount(21)
  await page.getByRole('button', { name: t.create, exact: true }).click()
  const form = page.getByRole('dialog', { name: t.create, exact: true })
  const initialAuthority = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/product-access/organizations/${first.id}/context`) &&
      r.status() === 200
  )
  await form.locator('button').filter({ hasText: t.selectOrganization }).click()
  await picker.getByLabel(t.organizationSearch, { exact: true }).fill('Alpha keys')
  await picker.getByRole('option').filter({ hasText: 'Alpha keys' }).click()
  await initialAuthority
  await form.getByLabel(t.name, { exact: true }).fill('Retained draft')
  await form
    .getByRole('checkbox', {
      name: messages.organizationRoles.capabilities.organizationUpdate.label,
      exact: true,
    })
    .check()
  const read = form.getByRole('checkbox', {
    name: messages.organizationRoles.capabilities.organizationRead.label,
    exact: true,
  })
  await expect(read).toBeChecked()
  await expect(read).toBeDisabled()
  await expect(form.getByText(t.readDependency, { exact: true })).toBeVisible()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let contextRequests = 0
  const beforeFocus = await form.boundingBox()
  await page.route('**/api/product-access/organizations/*/context', async (route) => {
    contextRequests++
    await gate
    await route.continue()
  })
  // Headless Chromium may report focus on multiple tabs; exercise the actual
  // window listeners without claiming proof of operating-system tab focus.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => contextRequests).toBeGreaterThan(0)
  await expect(form.getByLabel(t.name, { exact: true })).toHaveValue('Retained draft')
  await expect(form.getByText(t.creationDenied, { exact: true })).toHaveCount(0)
  await expect(form.getByText(first.id, { exact: true })).toHaveCount(0)
  await expect(read).toBeChecked()
  await expect(form.locator('[data-slot=select-trigger]')).toContainText(t.expiryOptions['30'])
  expect(await form.boundingBox()).toEqual(beforeFocus)
  release()
  await page.unrouteAll({ behavior: 'wait' })
  await form.getByRole('button', { name: t.cancel, exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('table')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await expectNoAxeViolations(page)
})
