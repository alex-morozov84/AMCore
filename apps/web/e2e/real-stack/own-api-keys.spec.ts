import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { closeCredentialPage } from '../shared/credential-artifacts'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

// Never retain one-time credentials in browser artifacts, including a failed assertion.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.afterEach(({ page }, info) => closeCredentialPage(page, info))
for (const locale of SUPPORTED_LOCALES) {
  test(`own keys ${locale}: create, conceal, explicit loss, unknown result and permanent revocation`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000)
    const target = activeTarget()
    if (locale !== DEFAULT_LOCALE) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ colorScheme: 'dark' })
    }
    const messages = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    )
    const t = messages.ownApiKeys
    const email = uniqueEmail('own-keys')
    const registration = await context.request.post('/api/auth/register', {
      headers: { origin: target.origins.product },
      data: { email, password: TEST_PASSWORD },
    })
    expect(registration.status()).toBe(201)
    const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
    const organization = await directApi(
      'organizations',
      { name: 'Own key browser proof' },
      login.accessToken
    )
    const path = new URL(localizedFrontendUrl(target.origins.product, locale, 'settings/api-keys'))
      .pathname
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    await page.goto(`${path}?organizationId=${organization.id}`)
    const create = page.getByRole('button', { name: t.create, exact: true })
    await expect(create).toBeEnabled()
    await create.click()
    const dialog = page.locator('[data-slot=dialog-content]')
    await dialog.locator('button').filter({ hasText: t.selectOrganization }).click()
    await page
      .locator(`div[aria-label="${t.selectOrganization}"]`)
      .getByRole('option')
      .filter({ hasText: 'Own key browser proof' })
      .click()
    await dialog.getByLabel(t.name, { exact: true }).fill('Browser export')
    const submit = dialog.getByRole('button', { name: t.create, exact: true })
    await expect(submit).toBeDisabled()
    await dialog
      .getByRole('checkbox', {
        name: messages.organizationRoles.capabilities.organizationRead.label,
        exact: true,
      })
      .check()
    await expectNoAxeViolations(page)
    await submit.click()
    const secretInput = dialog.getByRole('textbox', { name: t.secret, exact: true })
    await expect(secretInput).toBeVisible()
    await expect
      .poll(async () => (await secretInput.inputValue()).startsWith('amcore_live_'))
      .toBe(true)
    const secret = await secretInput.inputValue()
    expect(secret.startsWith('amcore_live_')).toBe(true)
    // A blurred page omits the value from DOM; a fresh probe restores the transient result.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect.poll(async () => (await secretInput.inputValue()) === t.secretMask).toBe(true)
    expect(await page.content().then((html) => html.includes(secret))).toBe(false)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(secretInput).toBeVisible()
    await dialog.getByRole('button', { name: t.close, exact: true }).click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText(t.loseDescription)
    await confirmation.getByRole('button', { name: t.cancel, exact: true }).click()
    await expect(secretInput).toBeVisible()
    await dialog.getByRole('button', { name: t.saved, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const card = page.getByRole('row').filter({ hasText: 'Browser export' })
    await expect(card).toBeVisible()
    expect(await page.content().then((html) => html.includes(secret))).toBe(false)
    await card
      .getByRole('button', { name: t.rowActions.replace('{name}', 'Browser export'), exact: true })
      .click()
    await page.getByRole('menuitem', { name: t.revoke, exact: true }).click()
    await confirmation.getByRole('button', { name: t.revoke, exact: true }).click()
    await expect(card.getByText(t.revokedSingle, { exact: true })).toBeVisible()
    expect(
      (
        await fetch(`http://127.0.0.1:${target.ports.api}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${secret}` },
        })
      ).status
    ).toBe(401)
    // The server commits, but the browser loses its reply. Closing/reopening never resends POST.
    let posts = 0
    await page.route('**/api/own-api-keys', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      posts++
      await route.fetch()
      await route.abort('failed')
    })
    await create.click()
    await dialog.getByLabel(t.name, { exact: true }).fill('Uncertain export')
    await dialog
      .getByRole('checkbox', {
        name: messages.organizationRoles.capabilities.organizationRead.label,
        exact: true,
      })
      .check()
    await submit.click()
    // Preflight verifies the session and organization before dispatching the command.
    await expect.poll(() => posts, { timeout: 15000 }).toBe(1)
    await expect(dialog.getByText(t.unknown, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: t.close, exact: true }).click()
    await page.getByRole('button', { name: t.openResult, exact: true }).click()
    await expect(dialog.getByText(t.unknown, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: t.checkList, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('row').filter({ hasText: 'Uncertain export' })).toBeVisible()
    await page.getByRole('button', { name: t.openResult, exact: true }).first().click()
    await expect(dialog.getByText(t.inspectionOnly, { exact: true })).toBeVisible()
    await dialog.getByRole('checkbox', { name: t.unknownAck, exact: true }).check()
    await dialog.getByRole('button', { name: t.dismissUnknown, exact: true }).click()
    await expect(dialog.getByLabel(t.name, { exact: true })).toHaveValue('')
    expect(posts).toBe(1)
    await expectNoAxeViolations(page)
    expect(failures).toEqual([])
  })
}
