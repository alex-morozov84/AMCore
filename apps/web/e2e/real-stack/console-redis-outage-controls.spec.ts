import { expect, test } from '@playwright/test'

import { settingsProof } from '../support/runtime-settings-proof'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

// Console route under a stalled session vault: the temporary state is the only difference an
// outsider may see, and only for a request that carries some session cookie. Operator identity,
// queue data and the shell never render. Normal denial returns after recovery.
test.describe.configure({ mode: 'serial' })

const URL = '/en/admin/background-work'
const STALL_MS = 40_000 // `pause-redis` pauses the stand's Redis for 40 s
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const forbidden = (body: string) => {
  expect(body).not.toContain('data-slot="table"')
  expect(body).not.toContain('data-sidebar')
  expect(body).not.toContain('Background queues</caption>')
}

test('Console route during a vault stall: no cookie, invented cookie and ordinary user', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000)
  // An ordinary signed-in user, a signed-out visitor and a visitor with an invented cookie.
  const user = await browser.newContext({ baseURL })
  const anonymous = await browser.newContext({ baseURL })
  const invented = await browser.newContext({ baseURL })
  try {
    const page = await user.newPage()
    await registerViaUi(page, uniqueEmail('console-outage-user'))
    await expect(page).toHaveURL(/\/en\/?$/)
    await invented.addCookies([{ name: 'amcore_session', value: 'A'.repeat(43), url: baseURL! }])

    // Healthy controls first: all three get the plain 404.
    for (const ctx of [user, anonymous, invented]) {
      expect((await ctx.request.get(URL, { timeout: 15_000 })).status()).toBe(404)
    }

    settingsProof('pause-redis')
    const TEMPORARY = /usually temporary|temporarily unavailable/i
    const during: Record<string, { status: number; shown: boolean }> = {}
    for (const [name, ctx] of [
      ['anonymous', anonymous],
      ['invented', invented],
      ['user', user],
    ] as const) {
      // The rendered page, not the payload: the translated text also sits in unrelated bundles.
      const page = await ctx.newPage()
      const response = await page.goto(URL, { timeout: 15_000 })
      during[name] = {
        status: response!.status(),
        shown: await page.getByText(TEMPORARY).first().isVisible(),
      }
      // Nothing rendered for anyone: no operator chrome, no queue data.
      forbidden(await page.content())
      await page.close()
    }
    // No cookie: the vault is never asked, so the plain denial stays a 404.
    expect(during.anonymous).toEqual({ status: 404, shown: false })
    // Disclosure under an outage (accepted limit): a cookie, even invented, sees the temporary
    // page instead of the 404. This is the page response (200 with the temporary text), not the
    // generic API 503. The assertions keep the accepted limit from changing unnoticed.
    expect(during.invented).toEqual({ status: 200, shown: true })
    expect(during.user).toEqual({ status: 200, shown: true })

    // After the stall the normal denial is back for all three.
    await sleep(STALL_MS + 2000)
    await expect(async () => {
      for (const ctx of [user, anonymous, invented]) {
        expect((await ctx.request.get(URL, { timeout: 10_000 })).status()).toBe(404)
      }
    }).toPass({ timeout: 60_000, intervals: [2000, 5000] })
  } finally {
    await user.close()
    await anonymous.close()
    await invented.close()
  }
})

test('an operator sees the temporary state, no shell, then the board after recovery', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const email = uniqueEmail('console-outage-operator')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)

  settingsProof('pause-redis')
  const response = await page.request.get(URL, { timeout: 10_000 })
  const body = await response.text()
  expect(body).toMatch(/temporarily unavailable/i)
  forbidden(body)
  expect(body).not.toContain(email)

  await sleep(STALL_MS + 2000)
  await expect(async () => {
    await page.goto(URL)
    await expect(page.getByRole('table', { name: 'Background queues' })).toBeVisible({
      timeout: 5000,
    })
  }).toPass({ timeout: 90_000, intervals: [2000, 5000] })
})
