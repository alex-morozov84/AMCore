import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DEFAULT_LOCALE,
  localizedFrontendUrl,
  type OrganizationBootstrap,
  type OrganizationPrepareAccount,
  SUPPORTED_LOCALES,
} from '@amcore/shared'
import { expect, type Page } from '@playwright/test'

import { activeTarget, guardedSql } from './managed-target.mjs'

export const SETUP_PASSWORD = 'SetupPassword123'
export function setupCommand(
  command: 'status' | 'prepare-account' | 'bootstrap' | 'diagnostics',
  input?: OrganizationPrepareAccount | OrganizationBootstrap
) {
  return invoke('setup-command', { command, ...(input ? { input } : {}) })
}
function invoke(script: string, input: unknown) {
  const m = activeTarget()
  if (
    !['organization-setup', 'organization-provisioning', 'product-admin-closed-signup'].includes(
      m.fixtureProfile ?? ''
    )
  )
    throw new Error('Use the organization-setup fixture')
  try {
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), '../../scripts/stand', `${script}.mjs`)],
      {
        input: JSON.stringify(input),
        encoding: 'utf8',
        maxBuffer: 262144,
        timeout: 20000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
          AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
        },
      }
    )
    return JSON.parse(output)
  } catch {
    throw new Error('Owned organization setup fixture failed; private output discarded')
  }
}

/** Only the actual generated email supplies the URL. Never replace a primary token hash. */
export async function proveSetupMailbox(page: Page, email: string) {
  const target = activeTarget()
  const copy = (locale: string) =>
    JSON.parse(readFileSync(resolve(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8'))
      .auth
  const base = copy(DEFAULT_LOCALE)
  await page.goto(localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, 'forgot-password'))
  await page.getByRole('textbox', { name: base.email, exact: true }).fill(email)
  await page.getByRole('button', { name: base.sendResetLink, exact: true }).click()
  await expect(page.getByText(base.forgotPasswordSuccess, { exact: true })).toBeVisible()
  const mail = invoke('setup-mail-consume', { to: email })
  try {
    const candidate = `${mail.text}\n${mail.html}`.match(
      /https?:\/\/[^\s<>"']+?\/reset-password\?token=[a-f0-9]{64}/
    )?.[0]
    if (!candidate) throw new Error('missing')
    const url = new URL(candidate)
    if (url.origin !== target.origins.product || url.searchParams.size !== 1)
      throw new Error('foreign')
    const locale = SUPPORTED_LOCALES.find(
      (code) =>
        new URL(localizedFrontendUrl(target.origins.product, code, 'reset-password')).pathname ===
        url.pathname
    )
    if (!locale) throw new Error('foreign-route')
    const t = copy(locale)
    await page.goto(url.href)
    await page.getByLabel(t.newPassword, { exact: true }).fill(SETUP_PASSWORD)
    await page.getByRole('button', { name: t.resetPasswordSubmit, exact: true }).click()
    await expect(page.getByText(t.resetPasswordSuccess, { exact: true })).toBeVisible()
  } catch {
    throw new Error('Actual emailed recovery link failed; token diagnostics discarded')
  }
  const row = guardedSql(
    'SELECT "emailVerified"::text FROM core.users WHERE "emailCanonical" = :\'email\';',
    { email }
  ).trim()
  expect(row).toBe('true')
}
