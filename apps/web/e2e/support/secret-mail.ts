import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { activeTarget } from './managed-target.mjs'

/** Real rendered fixture mail; never attach its contents or token-bearing URL to reports. */
export async function openSecretMail(
  page: Page,
  email: string,
  route: 'invite/accept' | 'verify-email' | 'reset-password',
  selectedOrigin?: string
) {
  const m = activeTarget()
  const origin = selectedOrigin ?? m.origins.product
  if (![m.origins.product, m.origins.staff].includes(origin))
    throw new Error('Unowned mail destination')
  let content = ''
  await expect
    .poll(
      () => {
        try {
          const raw = execFileSync(
            process.execPath,
            [resolve(m.snapshot, 'scripts/stand/setup-mail-consume.mjs')],
            {
              input: JSON.stringify({ to: email }),
              encoding: 'utf8',
              maxBuffer: 262144,
              timeout: 20000,
              stdio: ['pipe', 'pipe', 'pipe'],
              env: {
                NODE_ENV: 'test',
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
                AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
              },
            }
          )
          const value = JSON.parse(raw)
          content = `${value.text}\n${value.html}`
          return true
        } catch {
          return false
        }
      },
      { timeout: 15000, message: 'Expected owned rendered fixture mail' }
    )
    .toBe(true)
  try {
    const urls = content.match(/https?:\/\/[^\s<>"']+/g) ?? []
    const url = urls
      .map((candidate) => new URL(candidate.replaceAll('&amp;', '&')))
      .find(
        (candidate) =>
          candidate.origin === origin &&
          candidate.pathname.endsWith(`/${route}`) &&
          candidate.searchParams.size === 1 &&
          candidate.searchParams.has('token')
      )
    if (!url) throw new Error('missing')
    await page.goto(url.href)
  } catch {
    throw new Error('Actual emailed link failed; secret diagnostics discarded')
  }
}
