import { createRequire } from 'node:module'
import { join } from 'node:path'
import { dataAdmission, sql } from './ownership.mjs'
import { relay } from './relay.mjs'
import { save } from './state.mjs'
import { fixtureAccounts } from './fixture-accounts.mjs'

export async function preview(m, profile = 'default') {
  if (!['default', 'user', 'organization'].includes(profile))
    throw new Error('Unknown fixture profile')
  await dataAdmission(m)
  const require = createRequire(join(m.worktree, 'apps/web/package.json'))
  const { chromium, request } = require('@playwright/test')
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
      args: ['--proxy-bypass-list=<-loopback>'],
    })
    await fixtureAccounts(m, api, profile)
    if (profile === 'organization' && !m.organization) {
      const { organizationFixture } = await import('./organization-fixture.mjs')
      await organizationFixture(m, api)
    }
    for (const account of m.accounts) {
      const existing = await sql(
        m,
        `SELECT id || ':' || "systemRole" FROM core.users WHERE "emailCanonical" = :'email';`,
        true,
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
        await page.getByLabel(/email/i).fill(account.email)
        await page.getByLabel(/^password$/i).fill(account.password)
        await page.getByRole('button', { name: /^sign in$/i }).click()
        await page.waitForURL(`${m.origins.product}${m.localePrefix}`)
        if (account.role === 'SUPER_ADMIN') {
          await page.goto(
            m.origins.console
              ? `${m.origins.console}${m.localePrefix}`
              : `${m.localePrefix}/${m.consoleSlug}`
          )
          // Host-mode needs its own login cookie; product auth is not Console auth.
          if (page.url().includes('/login')) {
            await page.getByLabel(/email/i).fill(account.email)
            await page.getByLabel(/^password$/i).fill(account.password)
            await page.getByRole('button', { name: /^sign in$/i }).click()
            await page.waitForURL(`${m.origins.console}${m.localePrefix}`)
          }
          if (page.url().includes('/login')) throw new Error('Admin preview access not proved')
        }
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
    console.log(
      `Scenario: login, inspect current changes and Console access. Stop: pnpm stand down --id ${m.id}`
    )
  } finally {
    if (browser) await browser.close()
    if (api) await api.dispose()
    await proxy.close()
  }
}
