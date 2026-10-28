import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Messages } from 'next-intl'
import { DEFAULT_LOCALE, localePathPrefix, type MfaBrowserResult } from '@amcore/shared'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { generate } from 'otplib'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

// Live disposable factors/codes must never enter automatic failure artifacts.
// Playwright 1.64.1 checks this variable before its error-context DOM snapshot.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.afterEach(({ page }, info) => {
  void page
  // Locator matchers can supply a DOM snapshot even when automatic capture is off.
  // Preserve failure messages/status/stacks; remove only the secret-bearing DOM field.
  for (const error of info.errors) delete (error as { errorContext?: string }).errorContext
})
const prefix = localePathPrefix(DEFAULT_LOCALE)
const t = JSON.parse(
  readFileSync(join(activeTarget().snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
).accountMfa as Messages['accountMfa']

async function command(page: Page, control: Locator): Promise<MfaBrowserResult> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/auth/mfa' && r.request().method() === 'POST'
  )
  await control.click()
  const result = await response
  expect(result.ok()).toBe(true)
  return result.json()
}

async function finishLogin(page: Page, result: MfaBrowserResult): Promise<void> {
  let view = result.view
  if (view.kind === 'flow' && view.state === 'password_required') {
    await page.getByLabel(t.password, { exact: true }).fill(TEST_PASSWORD)
    view = (await command(page, page.getByRole('button', { name: t.continue, exact: true }))).view
  }
  if (view.kind === 'flow' && view.state === 'ready')
    view = (await command(page, page.getByRole('button', { name: t.continue, exact: true }))).view
  expect(view.kind === 'flow' ? view.state : view.kind).toBe('completed')
  await page.getByRole('button', { name: t.continue, exact: true }).click()
  await page.waitForURL((url) => url.pathname === prefix || url.pathname === `${prefix}/`)
}

async function backupSignIn(page: Page, email: string, code: string): Promise<void> {
  await page.context().clearCookies()
  await loginViaUi(page, email, { mfa: 'manual' })
  await page.waitForURL((url) => url.pathname === `${prefix}/mfa` && url.searchParams.has('flow'))
  expect((await page.request.get('/api/auth/me')).status()).toBe(401)
  await page.getByRole('button', { name: t.noApp, exact: true }).click()
  await page.getByLabel(t.backupCode, { exact: true }).fill(code)
  await finishLogin(
    page,
    await command(page, page.getByRole('button', { name: t.signIn, exact: true }))
  )
}

test('real operator enrollment, backup sign-in and code rotation retain browser authority', async ({
  page,
}) => {
  const email = uniqueEmail('mfa-browser')
  await registerViaUi(page, email)
  // Generic account assurance also survives a fork without the Console frontend.
  expect(
    guardedSql(
      `UPDATE core.users SET "systemRole" = 'SUPER_ADMIN' WHERE "emailCanonical" = :'email';`,
      { email }
    ).trim()
  ).toBe('UPDATE 1')
  await page.context().clearCookies()
  await loginViaUi(page, email, { mfa: 'manual' })
  await page.waitForURL((url) => url.pathname === `${prefix}/mfa` && url.searchParams.has('flow'))
  expect((await page.request.get('/api/auth/me')).status()).toBe(401)
  await command(page, page.getByRole('button', { name: t.connectApp, exact: true }))
  await expect(page.getByRole('img', { name: t.qrLabel, exact: true })).toBeVisible()
  await page.locator('details summary').click()
  const secret = await page.locator('details code').innerText()
  await page.getByLabel(t.appCode, { exact: true }).fill(await generate({ secret }))
  await command(page, page.getByRole('button', { name: t.continue, exact: true }))
  await expect(page.getByText(t.codesDescription, { exact: true })).toBeVisible()
  const codes = await page
    .getByRole('list', { name: t.backupCodesTitle, exact: true })
    .getByRole('listitem')
    .allTextContents()
  // The explanatory list is gone before this assertion: only backup-code rows remain.
  expect(codes.length).toBe(10)
  await expect(page.getByRole('button', { name: t.finishSetup, exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: t.savedCheckbox, exact: true }).check()
  await finishLogin(
    page,
    await command(page, page.getByRole('button', { name: t.finishSetup, exact: true }))
  )
  const admitted = await page.request.get('/api/auth/me')
  expect(admitted.ok()).toBe(true)
  expect((await admitted.json()).user.email).toBe(email)
  await backupSignIn(page, email, codes[0]!)
  await page.goto(`${prefix}/account/security`)
  await expect(page.getByText(t.enabled, { exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: t.newCodes, exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await command(page, confirmation.getByRole('button', { name: t.continue, exact: true }))
  await command(page, page.getByRole('button', { name: t.newCodes, exact: true }))
  await expect(page.getByText(t.newCodesDescription, { exact: true })).toBeVisible()
  const replacement = await page
    .getByRole('list', { name: t.backupCodesTitle, exact: true })
    .getByRole('listitem')
    .allTextContents()
  expect(replacement.length).toBe(10)
  await page.getByRole('checkbox', { name: t.savedCheckbox, exact: true }).check()
  const acknowledged = await command(
    page,
    page.getByRole('button', { name: t.codesSaved, exact: true })
  )
  expect(acknowledged.view.kind === 'flow' ? acknowledged.view.state : acknowledged.view.kind).toBe(
    'completed'
  )
  await page.getByRole('button', { name: t.continue, exact: true }).click()
  await backupSignIn(page, email, replacement[0]!)
  expect((await page.request.get('/api/auth/me')).status()).toBe(200)
})
