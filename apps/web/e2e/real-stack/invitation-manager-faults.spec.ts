import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createInvitationOperationId,
  localizedFrontendUrl,
  SUPPORTED_LOCALES,
} from '@amcore/shared'
import { expect, type Route, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

for (const locale of SUPPORTED_LOCALES)
  test(`manager ${locale}: primary faults, dirty generation, unknown recovery and late retirement`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000)
    const target = activeTarget()
    const ownerEmail = uniqueEmail('manager-fault-owner')
    expect(
      (
        await context.request.post('/api/auth/register', {
          headers: { origin: target.origins.product },
          data: { email: ownerEmail, password: TEST_PASSWORD },
        })
      ).status()
    ).toBe(201)
    const login = await directApi('auth/login', { email: ownerEmail, password: TEST_PASSWORD })
    const org = await directApi('organizations', { name: 'Manager fault proof' }, login.accessToken)
    const t = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    ).organizationInvitations
    const email = uniqueEmail('manager-dirty')
    const href = localizedFrontendUrl(
      target.origins.product,
      locale,
      `organizations/${org.id}/invites`
    )
    await page.goto(href)
    const invite = page.getByRole('button', { name: t.invite, exact: true, includeHidden: true })
    await expect(invite).toBeEnabled()
    await invite.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: t.email, exact: true }).fill(email)
    await dialog.getByRole('button', { name: t.invite, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const actionName = (action: string) =>
      t.actionFor.replace('{action}', action).replace('{email}', email)
    const row = page.getByRole('row').filter({ hasText: email })
    const menu = row.getByRole('button', { name: actionName(t.actions), exact: true })
    await menu.click()
    await page.getByRole('menuitem', { name: actionName(t.replace), exact: true }).click()
    await dialog.getByRole('checkbox', { name: 'VIEWER', exact: true }).check()
    const primaryRoute = (url: URL) => url.pathname.endsWith(`/organizations/${org.id}/invites`)
    let failList = true
    let release!: () => void
    let held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    let observed = new Promise<void>((resolve) => {
      entered = resolve
    })
    await page.route(primaryRoute, async (route) => {
      if (route.request().method() !== 'GET' || !failList) return route.continue()
      entered()
      await held
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ errorCode: 'SERVICE_UNAVAILABLE' }),
      })
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await observed
    await expect(invite).toBeDisabled()
    await expect(dialog.getByText(t.checking, { exact: true })).toBeVisible()
    const unavailable = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith(`/organizations/${org.id}/invites`) && r.status() === 503
    )
    release()
    await unavailable
    await expect(page.locator('[data-slot="alert"]').first()).toBeVisible()
    await expect(invite).toBeDisabled()
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0)
    failList = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(dialog.getByRole('checkbox', { name: 'VIEWER', exact: true })).toBeChecked()
    // Independent issuance changes generation while the local complete selection is dirty.
    const list = await directApi(
      `organizations/${org.id}/invites?status=pending`,
      undefined,
      login.accessToken
    )
    const stored = list.data.find((item: { email: string }) => item.email === email)
    const changed = await fetch(
      `http://127.0.0.1:${target.ports.api}/api/v1/organizations/${org.id}/invites/${stored.id}/reissue`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${login.accessToken}`,
          'content-type': 'application/json',
          'x-invitation-operation-id': createInvitationOperationId(),
        },
        body: JSON.stringify({ mode: 'repeat', expectedGeneration: stored.generation }),
      }
    )
    expect(changed.status).toBe(202)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(dialog.getByText(t.generationChanged, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'VIEWER', exact: true })).toBeChecked()
    await expect(dialog.getByRole('button', { name: t.resend, exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: t.reviewCurrent, exact: true }).click()
    await dialog.getByRole('checkbox', { name: t.reissueConfirmation, exact: true }).check()
    await dialog.getByRole('button', { name: t.cancel, exact: true }).click()
    await expect(menu).toBeFocused()
    // An open revoke confirmation is also blocked and masked during a failed primary refresh.
    await menu.click()
    await page.getByRole('menuitem', { name: actionName(t.revoke), exact: true }).click()
    failList = true
    held = new Promise<void>((resolve) => {
      release = resolve
    })
    observed = new Promise<void>((resolve) => {
      entered = resolve
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await observed
    await expect(
      page.getByRole('alertdialog').getByRole('button', { name: t.revoke, exact: true })
    ).toBeDisabled()
    release()
    await expect(page.locator('[data-slot="alert"]').first()).toBeVisible()
    await expect(
      page.getByRole('alertdialog').getByRole('button', { name: t.revoke, exact: true })
    ).toBeDisabled()
    await page.getByRole('alertdialog').getByRole('button', { name: t.cancel, exact: true }).click()
    await expect(page.getByRole('textbox', { name: t.search, exact: true })).toBeFocused()
    failList = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(row).toBeVisible()
    // A roles-only outage cannot hide the primary list or disable independent revoke.
    await page.route('**/invites/role-choices?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ errorCode: 'SERVICE_UNAVAILABLE' }),
      })
    )
    await invite.click()
    await expect(dialog.locator('[data-slot="alert"]')).toBeVisible()
    await expect(dialog.getByRole('button', { name: t.invite, exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: t.cancel, exact: true }).click()
    await expect(menu).toBeEnabled()
    await page.unroute('**/invites/role-choices?*')
    // A committed command with lost browser response is recovered by receipt, not a fresh send.
    let sends = 0
    const lose = async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue()
      sends++
      expect((await route.fetch()).status()).toBe(202)
      await route.abort('failed')
    }
    await page.route(primaryRoute, lose)
    await invite.click()
    await dialog
      .getByRole('textbox', { name: t.email, exact: true })
      .fill(uniqueEmail('manager-unknown'))
    await dialog.getByRole('button', { name: t.invite, exact: true }).click()
    await expect(page.getByText(t.unknownOutcome, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: t.cancel, exact: true }).click()
    await page.getByRole('button', { name: t.recover, exact: true }).click()
    await expect(invite).toBeEnabled()
    expect(sends).toBe(1)
    await page.unroute(primaryRoute, lose)
    // Delay a real successful acknowledgment until another login has retired this context.
    let finish!: () => void
    const late = new Promise<void>((resolve) => {
      finish = resolve
    })
    let committed!: () => void
    const commit = new Promise<void>((resolve) => {
      committed = resolve
    })
    await page.route(primaryRoute, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(202)
      committed()
      await late
      await route.fulfill({ response })
    })
    await invite.click()
    await dialog
      .getByRole('textbox', { name: t.email, exact: true })
      .fill(uniqueEmail('manager-late'))
    await dialog.getByRole('button', { name: t.invite, exact: true }).click()
    await commit
    const replacement = uniqueEmail('replacement-session')
    expect(
      (
        await context.request.post('/api/auth/register', {
          headers: { origin: target.origins.product },
          data: { email: replacement, password: TEST_PASSWORD },
        })
      ).status()
    ).toBe(201)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText(t.denied, { exact: true })).toBeVisible()
    finish()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0)
    await expect(invite).toBeDisabled()
  })
