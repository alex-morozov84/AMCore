import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

async function expectSettledAccessibility(page: Page) {
  // A disabled→enabled opacity transition must finish before measuring contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running')
  )
  await expectNoAxeViolations(page)
}

// Issuance acknowledgment proves a decision, not delivery of email.
test('invitations manager: complete roles,202, reissue,204, search and mobile EN/RU', async ({
  page,
  context,
}) => {
  test.setTimeout(180000)
  const target = activeTarget()
  const ownerEmail = uniqueEmail('invitation-manager')
  const registration = await context.request.post('/api/auth/register', {
    headers: { origin: target.origins.product },
    data: { email: ownerEmail, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const login = await directApi('auth/login', { email: ownerEmail, password: TEST_PASSWORD })
  const org = await directApi(
    'organizations',
    { name: 'Invitation manager browser proof' },
    login.accessToken
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.name))
  page.on('response', async (response) => {
    if (!new URL(response.url()).pathname.includes('/invites') || response.ok()) return
    const body = await response.json().catch(() => null)
    const code =
      typeof body?.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(body.errorCode)
        ? body.errorCode
        : 'UNSTRUCTURED_ERROR'
    await test.info().attach('manager-response-status', {
      body: JSON.stringify({ status: response.status(), errorCode: code }),
      contentType: 'application/json',
    })
  })
  for (const locale of SUPPORTED_LOCALES) {
    const t = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    ).organizationInvitations
    await page.goto(
      localizedFrontendUrl(target.origins.product, locale, `organizations/${org.id}/invites`)
    )
    await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: t.invite, exact: true })).toBeEnabled()
    await expect(page.getByText(t.empty, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: t.invite, exact: true }).click()
    const dialog = page.getByRole('dialog')
    const recipient = uniqueEmail(`manager-${locale}`)
    await dialog.getByRole('textbox', { name: t.email, exact: true }).fill(recipient)
    await expect(dialog.getByRole('checkbox', { name: 'MEMBER', exact: true })).toBeChecked()
    const roleSearch = dialog.getByRole('textbox', { name: t.roleSearch, exact: true })
    await roleSearch.fill('VIEWER')
    await roleSearch.press('Enter')
    await dialog.getByRole('checkbox', { name: 'VIEWER', exact: true }).check()
    await roleSearch.fill('ADMIN')
    await roleSearch.press('Enter')
    await expect(dialog.getByRole('checkbox', { name: 'ADMIN', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: t.clear, exact: true }).click()
    await expect(dialog.getByRole('checkbox', { name: 'MEMBER', exact: true })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'VIEWER', exact: true })).toBeChecked()
    await expectSettledAccessibility(page)
    const issuance = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/invites')
    )
    await dialog.getByRole('button', { name: t.invite, exact: true }).click()
    expect((await issuance).status()).toBe(202)
    await expect(page.getByText(t.processed, { exact: true })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.invite, exact: true })).toBeEnabled()
    const row = page.getByRole('row').filter({ hasText: recipient })
    await expect(row).toBeVisible()
    await expect(row.getByText('MEMBER', { exact: true })).toBeVisible()
    await expect(row.getByText('VIEWER', { exact: true })).toBeVisible()
    const search = page.getByRole('textbox', { name: t.search, exact: true })
    await search.fill(recipient)
    await search.press('Enter')
    await expect(page).toHaveURL(new RegExp('search='))
    await expect(row).toBeVisible()
    await row
      .getByRole('button', {
        name: t.actionFor.replace('{action}', t.actions).replace('{email}', recipient),
        exact: true,
      })
      .click()
    await page
      .getByRole('menuitem', {
        name: t.actionFor.replace('{action}', t.repeat).replace('{email}', recipient),
        exact: true,
      })
      .click()
    await expect(dialog.getByRole('textbox', { name: t.email, exact: true })).toHaveAttribute(
      'readonly',
      ''
    )
    await dialog.getByRole('checkbox', { name: t.reissueConfirmation, exact: true }).check()
    const resend = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/reissue')
    )
    await dialog.getByRole('button', { name: t.resend, exact: true }).click()
    expect((await resend).status()).toBe(202)
    await expect(page.getByText(t.processed, { exact: true })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.invite, exact: true })).toBeEnabled()
    await expect(
      row.getByRole('button', {
        name: t.actionFor.replace('{action}', t.actions).replace('{email}', recipient),
        exact: true,
      })
    ).toBeEnabled()
    await row
      .getByRole('button', {
        name: t.actionFor.replace('{action}', t.actions).replace('{email}', recipient),
        exact: true,
      })
      .click()
    await page
      .getByRole('menuitem', {
        name: t.actionFor.replace('{action}', t.replace).replace('{email}', recipient),
        exact: true,
      })
      .click()
    await expect(dialog.getByRole('textbox', { name: t.email, exact: true })).toHaveAttribute(
      'readonly',
      ''
    )
    await dialog.getByRole('checkbox', { name: 'VIEWER', exact: true }).uncheck()
    await dialog.getByRole('checkbox', { name: t.reissueConfirmation, exact: true }).check()
    const replacement = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/reissue')
    )
    await dialog.getByRole('button', { name: t.resend, exact: true }).click()
    expect((await replacement).status()).toBe(202)
    await expect(page.getByText(t.processed, { exact: true })).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.invite, exact: true })).toBeEnabled()
    await expect(row.getByText('MEMBER', { exact: true })).toBeVisible()
    await expect(row.getByText('VIEWER', { exact: true })).toHaveCount(0)
    await expectSettledAccessibility(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByText(recipient, { exact: true }).filter({ visible: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await expectSettledAccessibility(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await row
      .getByRole('button', {
        name: t.actionFor.replace('{action}', t.actions).replace('{email}', recipient),
        exact: true,
      })
      .click()
    await page
      .getByRole('menuitem', {
        name: t.actionFor.replace('{action}', t.revoke).replace('{email}', recipient),
        exact: true,
      })
      .click()
    const revoke = page.waitForResponse(
      (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname.includes('/invites/')
    )
    await page.getByRole('alertdialog').getByRole('button', { name: t.revoke, exact: true }).click()
    const revokeResponse = await revoke
    expect(revokeResponse.status()).toBe(200)
    expect((await revokeResponse.json()).data).toEqual({ status: 'revoked' })
    await expect(page.getByText(t.revokedProcessed, { exact: true })).toBeVisible()
    await expect(row).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.invite, exact: true })).toBeEnabled()
    await search.clear()
    await search.press('Enter')
    await expect(page.getByText(t.empty, { exact: true })).toBeVisible()
  }
  expect(errors).toEqual([])
})
