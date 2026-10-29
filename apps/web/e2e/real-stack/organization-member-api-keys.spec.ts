import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'

test('member keys: scoped list, confirmation, permanent revoke and unknown-result recovery', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const catalogue = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const t = catalogue.memberApiKeys
  const email = uniqueEmail('member-keys')
  const registration = await browserCredentialRequest(context.request, '/api/auth/register', {
    headers: { origin: target.origins.product },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const org = await directApi(
    'organizations',
    { name: 'Member key browser proof' },
    login.accessToken
  )
  const key = await directApi(
    'api-keys',
    { name: 'Daily export', organizationId: org.id, scopes: ['read:Organization'] },
    login.accessToken
  )
  await directApi(
    'api-keys',
    {
      name: 'Old export',
      organizationId: org.id,
      scopes: ['read:Organization'],
      expiresAt: '2026-01-01T00:00:00.000Z',
    },
    login.accessToken
  )
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto(
    new URL(
      localizedFrontendUrl(
        target.origins.product,
        DEFAULT_LOCALE,
        `organizations/${org.id}/members`
      )
    ).pathname
  )
  const open = async () => {
    await page
      .getByRole('button', {
        name: catalogue.organizationMembers.actionFor.replace('{name}', email),
      })
      .filter({ visible: true })
      .click()
    await page
      .getByRole('menuitem', { name: catalogue.organizationMembers.apiKeys, exact: true })
      .click()
  }
  await open()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: t.title })).toBeVisible()
  await expect(dialog.getByText('Daily export', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Old export', { exact: true })).toBeVisible()
  expect(((await dialog.textContent()) ?? '').includes(key.key)).toBe(false)
  await expectNoAxeViolations(page)
  await dialog.getByRole('button', { name: t.revokeAll, exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText(t.allWarning)
  await expect(confirm.getByRole('button', { name: t.cancel })).toBeFocused()
  await confirm.getByRole('button', { name: t.cancel }).click()
  await expect(dialog.getByText('Daily export', { exact: true })).toBeVisible()
  const card = dialog.locator('[data-slot="card"]').filter({ hasText: 'Daily export' })
  await card.getByRole('button', { name: t.revoke, exact: true }).click()
  await confirm.getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(card.getByText(t.organization_admin_revoked, { exact: true })).toBeVisible()
  expect(
    (
      await fetch(`http://127.0.0.1:${target.ports.api}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${key.key}` },
      })
    ).status
  ).toBe(401)
  await expectNoAxeViolations(page)
  // The server commits, but the browser loses the acknowledgment. Do not replay.
  await page.route(
    '**/api/product-access/organizations/*/members/*/api-keys/revoke-all',
    async (route) => {
      await route.fetch()
      await route.abort('failed')
    }
  )
  await dialog.getByRole('button', { name: t.revokeAll, exact: true }).click()
  await confirm.getByRole('button', { name: t.confirm, exact: true }).click()
  await expect(dialog.getByText(t.unknown, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: t.close, exact: true }).click()
  await open()
  await expect(dialog.getByText(t.unknown, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: t.check, exact: true }).click()
  await expect(dialog.getByRole('button', { name: t.revokeAll, exact: true })).toBeDisabled()
  await expectNoAxeViolations(page)
  expect(failures).toEqual([])
})
