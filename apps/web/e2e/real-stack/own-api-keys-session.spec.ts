import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { closeCredentialPage } from '../shared/credential-artifacts'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.afterEach(({ page }, info) => closeCredentialPage(page, info))
for (const change of ['same-user-login', 'other-user-login'] as const) {
  test(`own keys: delayed 201 cannot reveal after ${change}`, async ({ page, context }) => {
    test.setTimeout(120000)
    const target = activeTarget()
    const messages = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
    )
    const t = messages.ownApiKeys
    const email = uniqueEmail('own-key-session')
    const auth = {
      headers: { origin: target.origins.product },
      data: { email, password: TEST_PASSWORD },
    }
    expect(
      (await browserCredentialRequest(context.request, '/api/auth/register', auth)).status()
    ).toBe(201)
    const login = await directApi('auth/login', auth.data)
    const organization = await directApi(
      'organizations',
      { name: 'Session boundary proof' },
      login.accessToken
    )
    const path = new URL(
      localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, 'settings/api-keys')
    ).pathname
    await page.goto(`${path}?organizationId=${organization.id}`)
    await page.getByRole('button', { name: t.create, exact: true }).click()
    const dialog = page.locator('[data-slot=dialog-content]')
    await dialog.locator('button').filter({ hasText: t.selectOrganization }).click()
    await page
      .locator(`div[aria-label="${t.selectOrganization}"]`)
      .getByRole('option')
      .filter({ hasText: 'Session boundary proof' })
      .click()
    await dialog.getByLabel(t.name, { exact: true }).fill('Old session export')
    await dialog
      .getByRole('checkbox', {
        name: messages.organizationRoles.capabilities.organizationRead.label,
        exact: true,
      })
      .check()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let committed!: () => void
    const ready = new Promise<void>((resolve) => {
      committed = resolve
    })
    await page.route('**/api/own-api-keys', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      committed()
      await gate
      await route.fulfill({ response })
    })
    await dialog.getByRole('button', { name: t.create, exact: true }).click()
    await ready
    if (change === 'same-user-login')
      expect(
        (await browserCredentialRequest(context.request, '/api/auth/login', auth)).status()
      ).toBe(200)
    else
      expect(
        (
          await browserCredentialRequest(context.request, '/api/auth/register', {
            ...auth,
            data: { ...auth.data, email: uniqueEmail('new-owner') },
          })
        ).status()
      ).toBe(201)
    release()
    await expect(page.getByText(t.sessionChanged, { exact: true })).toBeVisible()
    expect(
      await page
        .locator('input')
        .evaluateAll((inputs) =>
          inputs.some(
            (input) => input instanceof HTMLInputElement && input.value.startsWith('amcore_live_')
          )
        )
    ).toBe(false)
    await expect(page.getByRole('textbox', { name: t.secret, exact: true })).toHaveCount(0)
    await expect(page.getByText('Old session export', { exact: true })).toHaveCount(0)
  })
}
