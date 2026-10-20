import { admitInvocation, endInvocation } from './invocation.mjs'
import { previewLabels } from './preview-labels.mjs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { cleanEnvironment } from './process.mjs'
import { sql } from './ownership.mjs'
import { relay } from './relay.mjs'
import { save } from './state.mjs'
import { fixtureAccounts } from './fixture-accounts.mjs'
import {
  organizationRolesAddresses,
  organizationRolesFixture,
} from './organization-roles-fixture.mjs'

export async function preview(m, profile = 'default') {
  const profiles = [
    'default',
    'user',
    'organization',
    'organization-roles',
    'organization-creation',
    'member-api-keys',
    'product-admin-three-host',
    'product-admin-console-path',
  ]
  // AMCORE_CONSOLE_NOTIFICATION_PROFILE_START
  profiles.push('notification-work')
  if (profile === 'notification-work' && m.fixtureProfile !== profile)
    throw new Error('Notification work preview needs a fresh stand created with this profile')
  // AMCORE_CONSOLE_NOTIFICATION_PROFILE_END
  // AMCORE_CONSOLE_AI_PROFILE_START
  profiles.push('ai-run-control')
  // AMCORE_CONSOLE_AI_PROFILE_END
  // AMCORE_CONSOLE_ESTABLISHMENT_PROFILE_START
  profiles.push('organization-establishment')
  if (
    profile === 'organization-establishment' &&
    (!m.consoleEnabled || m.fixtureProfile !== profile || m.purpose !== 'preview')
  )
    throw new Error('Initial setup preview needs a fresh enabled-Console stand with this profile')
  // AMCORE_CONSOLE_ESTABLISHMENT_PROFILE_END
  if (!profiles.includes(profile)) throw new Error('Unknown fixture profile')
  await admitInvocation(m)
  const labels = await previewLabels(m)
  const require = createRequire(join(m.worktree, 'apps/web/package.json'))
  const { chromium, request } = require('@playwright/test')
  const { SUPPORTED_LOCALES } = require('@amcore/shared')
  const tmp = `${m.worktree}/.amcore/stands/${m.id}/tmp`
  await mkdir(tmp, { recursive: true, mode: 0o700 })
  const proxy = await relay(Object.values(m.origins))
  let api, browser
  try {
    api = await request.newContext({
      baseURL: m.origins.api,
      proxy: { server: proxy.url },
      ignoreHTTPSErrors: m.topology === 'host',
    })
    browser = await chromium.launch({
      proxy: { server: proxy.url },
      env: cleanEnvironment({ TMPDIR: tmp }),
      args: ['--proxy-bypass-list=<-loopback>'],
    })
    await fixtureAccounts(m, api, profile)
    // AMCORE_CONSOLE_ESTABLISHMENT_FIXTURE_START
    if (profile === 'organization-establishment') {
      const { executeSetupCommand } = await import('./setup-command.mjs')
      const probes = await executeSetupCommand(m, { command: 'diagnostics' })
      if (
        probes.invalid.exit !== 2 ||
        probes.invalid.output.status !== 'invalid_input' ||
        probes.unavailable.exit !== 4 ||
        probes.unavailable.output.status !== 'SETUP_UNCONFIRMED'
      )
        throw new Error('Compiled runner recovery diagnostics failed')
      const recipient = m.accounts.find((account) => account.role === 'USER')
      if (!recipient) throw new Error('Initial setup preview recipient missing')
      if (m.establishmentPreviewRecipient && m.establishmentPreviewRecipient !== recipient.id)
        throw new Error('Initial setup preview recipient changed')
      if (!m.establishmentPreviewRecipient) {
        // Demo-only mailbox substitute. Real rendered-mail proof belongs to the isolated E2E fixture.
        await sql(
          m,
          'UPDATE core.users SET "emailVerified" = true WHERE id = :\'id\' AND "emailCanonical" = :\'email\';',
          { id: recipient.id, email: recipient.email }
        )
        m.establishmentPreviewRecipient = recipient.id
        await save(m)
      }
    }
    // AMCORE_CONSOLE_ESTABLISHMENT_FIXTURE_END
    if (profile === 'organization') {
      const { organizationFixture } = await import('./organization-fixture.mjs')
      await organizationFixture(m, api)
    }
    if (
      ['organization-roles', 'product-admin-three-host', 'product-admin-console-path'].includes(
        profile
      )
    )
      await organizationRolesFixture(m, api)
    if (profile === 'member-api-keys') {
      const { memberApiKeysFixture } = await import('./member-api-keys-fixture.mjs')
      await memberApiKeysFixture(m, api)
    }
    // AMCORE_CONSOLE_NOTIFICATION_FIXTURE_START
    if (profile === 'notification-work') {
      const { notificationWorkFixture } = await import('./notification-work-fixture.mjs')
      await notificationWorkFixture(m)
    }
    // AMCORE_CONSOLE_NOTIFICATION_FIXTURE_END
    // AMCORE_CONSOLE_AI_FIXTURE_START
    if (profile === 'ai-run-control') {
      const { aiRunControlFixture } = await import('./ai-run-control-fixture.mjs')
      await aiRunControlFixture(m, api)
    }
    // AMCORE_CONSOLE_AI_FIXTURE_END
    for (const account of m.accounts) {
      const existing = await sql(
        m,
        `SELECT id || ':' || "systemRole" FROM core.users WHERE "emailCanonical" = :'email';`,
        { email: account.email }
      )
      if (existing.trim() !== `${account.id}:${account.role}`)
        throw new Error('Preview account changed; refusing silent reset')
      const context = await browser.newContext({
        baseURL: m.origins.product,
        ignoreHTTPSErrors: m.topology === 'host',
      })
      try {
        const page = await context.newPage()
        await page.goto(`${m.localePrefix}/login`)
        await page.getByLabel(labels.product.email, { exact: true }).fill(account.email)
        await page.getByLabel(labels.product.password, { exact: true }).fill(account.password)
        await page.getByRole('button', { name: labels.product.submit, exact: true }).click()
        await page.waitForURL(
          (url) =>
            url.origin === m.origins.product &&
            (m.localePrefix
              ? SUPPORTED_LOCALES.some((locale) => url.pathname === `/${locale}`)
              : url.pathname === '/')
        )
        if (profile === 'organization-creation' && account.role === 'USER') {
          await page.goto(`${m.localePrefix}/organizations?view=list`)
          await page
            .getByRole('heading', { name: labels.product.creationTitle, exact: true })
            .waitFor()
          await page.getByRole('button', { name: labels.product.create, exact: true }).click()
          await page.getByLabel(labels.product.organizationName, { exact: true }).waitFor()
          await page.screenshot({
            path: `${m.worktree}/.amcore/stands/${m.id}/preview-create-form.png`,
          })
          await page
            .getByRole('button', { name: labels.product.cancelCreation, exact: true })
            .click()
        }
        // AMCORE_CONSOLE_PREVIEW_ACCESS_START
        if (account.role === 'SUPER_ADMIN') {
          await page.goto(
            m.origins.console
              ? `${m.origins.console}${m.localePrefix}`
              : `${m.localePrefix}/${m.consoleSlug}`
          )
          // Host-mode needs its own login cookie; product auth is not Console auth.
          if (page.url().includes('/login')) {
            await page.getByLabel(labels.console.email, { exact: true }).fill(account.email)
            await page.getByLabel(labels.console.password, { exact: true }).fill(account.password)
            await page.getByRole('button', { name: labels.console.submit, exact: true }).click()
            await page.waitForURL(`${m.origins.console}${m.localePrefix}`)
          }
          if (page.url().includes('/login')) throw new Error('Admin preview access not proved')
          // AMCORE_CONSOLE_ESTABLISHMENT_PREVIEW_START
          if (profile === 'organization-establishment') {
            const base = m.origins.console
              ? `${m.origins.console}${m.localePrefix}`
              : `${m.localePrefix}/${m.consoleSlug}`
            await page.goto(`${base}/organizations`)
            await page
              .getByRole('heading', { name: labels.console.setupTitle, exact: true })
              .waitFor()
            const states = labels.console.setupStates.map((text) =>
              text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            )
            await page
              .getByRole('status')
              .filter({ hasText: new RegExp(`^(?:${states.join('|')})$`) })
              .or(page.getByRole('heading', { name: labels.console.setupFirstStep, exact: true }))
              .or(page.getByRole('heading', { name: new RegExp(`^(?:${states.join('|')})$`) }))
              .waitFor()
          }
          // AMCORE_CONSOLE_ESTABLISHMENT_PREVIEW_END
          if (profile === 'notification-work') {
            const { notificationWorkPreview } = await import('./notification-work-fixture.mjs')
            await notificationWorkPreview(page, m, SUPPORTED_LOCALES)
          }
          if (profile === 'ai-run-control') {
            const { aiRunControlPreview } = await import('./ai-run-control-fixture.mjs')
            await aiRunControlPreview(page, m)
          }
        }
        // AMCORE_CONSOLE_PREVIEW_ACCESS_END
        await page.screenshot({
          path: `${m.worktree}/.amcore/stands/${m.id}/preview-${account.role}.png`,
        })
      } finally {
        await context.close()
      }
    }
    m.state = 'preview-verified'
    await save(m)
    console.log(
      `Stand: ${m.id}\nBranch: ${m.branch}\nSource: ${m.sourceHash}\nURL: ${m.origins.product}${m.localePrefix}`
    )
    for (const a of m.accounts) console.log(`${a.role}: ${a.email}\nPassword: ${a.password}`)
    if (
      ['organization-roles', 'product-admin-three-host', 'product-admin-console-path'].includes(
        profile
      )
    )
      for (const line of organizationRolesAddresses(
        m,
        m.localePrefix,
        m.origins.staff ?? m.origins.product
      ))
        console.log(line)
    if (profile === 'member-api-keys')
      console.log(
        `Members: ${m.origins.product}${m.localePrefix}/organizations/${m.organization.id}/members`
      )
    let scenario = 'login, inspect current changes'
    // AMCORE_CONSOLE_PREVIEW_SCENARIO_START
    scenario += ' and Console access'
    // AMCORE_CONSOLE_PREVIEW_SCENARIO_END
    console.log(`Scenario: ${scenario}. Stop: pnpm stand down --id ${m.id}`)
  } finally {
    endInvocation(m)
    if (browser) await browser.close()
    if (api) await api.dispose()
    await proxy.close()
  }
}
