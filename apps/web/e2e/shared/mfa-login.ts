import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Messages } from 'next-intl'
import { coerceSupportedLocale, DEFAULT_LOCALE, type MfaBrowserResult } from '@amcore/shared'
import { expect, type Locator, type Page } from '@playwright/test'
import { generate } from 'otplib'

import { activeTarget } from '../support/managed-target.mjs'
import { redactMfaFailure } from '../support/mfa-secret-errors.mjs'

const wallets = new Map<string, { codes: string[] }>()
const secrets = new Set<string>()

async function clickCommand(page: Page, control: Locator): Promise<MfaBrowserResult> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/mfa') && r.request().method() === 'POST'
  )
  await control.click()
  const value = await response
  expect(value.ok()).toBe(true)
  return value.json()
}

/** Domain UI setup uses the real enrollment/proof/publication journey, not a password-only grant. */
export async function completeMfaSignIn(page: Page, email: string): Promise<void> {
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'
  const target = activeTarget()
  const t = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  ).accountMfa as Messages['accountMfa']
  try {
    await page.waitForURL((url) => url.pathname.endsWith('/mfa') && url.searchParams.has('flow'))
    const connect = page.getByRole('button', { name: t.connectApp, exact: true })
    const appCode = page.getByLabel(t.appCode, { exact: true })
    await expect(connect.or(appCode)).toBeVisible()
    let result: MfaBrowserResult
    if (await connect.isVisible()) {
      const draft = await clickCommand(page, connect)
      if (!draft.enrollment) throw new Error('MFA test enrollment returned no seed')
      const secret = draft.enrollment.secret
      secrets.add(secret)
      const token = await generate({ secret })
      secrets.add(token)
      await appCode.fill(token)
      await clickCommand(page, page.getByRole('button', { name: t.continue, exact: true }))
      await expect(page.getByText(t.codesDescription, { exact: true })).toBeVisible()
      const codes = await page
        .getByRole('list', { name: t.backupCodesTitle, exact: true })
        .getByRole('listitem')
        .allTextContents()
      codes.forEach((code) => secrets.add(code))
      expect(codes.length).toBe(10)
      wallets.set(email, { codes })
      await page.getByRole('checkbox', { name: t.savedCheckbox, exact: true }).check()
      result = await clickCommand(
        page,
        page.getByRole('button', { name: t.finishSetup, exact: true })
      )
    } else {
      const code = wallets.get(email)?.codes.shift()
      if (!code)
        throw new Error('MFA domain fixture requires an unused code from its prior enrollment')
      await page.getByRole('button', { name: t.noApp, exact: true }).click()
      await page.getByLabel(t.backupCode, { exact: true }).fill(code)
      result = await clickCommand(page, page.getByRole('button', { name: t.signIn, exact: true }))
    }
    expect(result.view.kind).toBe('flow')
    expect(['ready', 'completed']).toContain(result.view.kind === 'flow' && result.view.state)
    // The application reconciles publication and navigates automatically after the proof.
    await page.waitForURL((url) => !url.pathname.endsWith('/mfa'))
  } catch (error) {
    throw redactMfaFailure(error, secrets)
  }
}

/** Completes the second proof in the existing sensitive-action dialog. */
export async function completeMfaStepUp(page: Page, email: string): Promise<void> {
  const target = activeTarget()
  const locale = coerceSupportedLocale(new URL(page.url()).pathname.split('/')[1] ?? DEFAULT_LOCALE)
  const t = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
  ).accountMfa as Messages['accountMfa']
  try {
    const title = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    ).console.stepUpTitle as string
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await expect(dialog.getByLabel(t.appCode, { exact: true })).toBeVisible()
    const code = wallets.get(email)?.codes.shift()
    if (!code) throw new Error('MFA step-up requires an unused enrolled backup code')
    await dialog.getByRole('button', { name: t.noApp, exact: true }).click()
    await dialog.getByLabel(t.backupCode, { exact: true }).fill(code)
    await dialog.getByRole('button', { name: t.continue, exact: true }).click()
    await expect(dialog).toBeHidden()
  } catch (error) {
    throw redactMfaFailure(error, secrets)
  }
}
