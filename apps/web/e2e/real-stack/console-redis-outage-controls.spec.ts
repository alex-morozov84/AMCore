import { type BrowserContext, expect, test } from '@playwright/test'

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

test('Console vault stall preserves four isolated sessions and recovery', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000)
  const contexts: BrowserContext[] = []
  const failures: unknown[] = []
  const createContext = async () => {
    const context = await browser.newContext({ baseURL })
    contexts.push(context)
    return context
  }
  try {
    const user = await createContext()
    const anonymous = await createContext()
    const invented = await createContext()
    const operator = await createContext()
    const page = await user.newPage()
    await registerViaUi(page, uniqueEmail('console-outage-user'))
    await expect(page).toHaveURL(/\/en\/?$/)
    await invented.addCookies([{ name: 'amcore_session', value: 'A'.repeat(43), url: baseURL! }])
    const operatorPage = await operator.newPage()
    const email = uniqueEmail('console-outage-operator')
    await registerViaUi(operatorPage, email)
    setSystemRole(email, 'SUPER_ADMIN')
    await operator.clearCookies()
    await loginViaUi(operatorPage, email)

    await test.step('healthy outsider sessions receive plain denial', async () => {
      for (const ctx of [user, anonymous, invented]) {
        expect((await ctx.request.get(URL, { timeout: 15_000 })).status()).toBe(404)
      }
    })

    // Start before the synchronous command: its latency must not extend the fault window.
    const started = performance.now()
    settingsProof('pause-redis')
    await test.step('outsiders see only the accepted temporary state during the stall', async () => {
      const TEMPORARY = /usually temporary|temporarily unavailable/i
      const during: Record<string, { status: number; shown: boolean }> = {}
      for (const [name, ctx] of [
        ['anonymous', anonymous],
        ['invented', invented],
        ['user', user],
      ] as const) {
        // Inspect rendered DOM: translated text also occurs in unrelated bundles.
        const page = await ctx.newPage()
        const response = await page.goto(URL, { timeout: 15_000 })
        during[name] = {
          status: response!.status(),
          shown: await page.getByText(TEMPORARY).first().isVisible(),
        }
        forbidden(await page.content())
        await page.close()
      }
      expect(during.anonymous).toEqual({ status: 404, shown: false })
      expect(during.invented).toEqual({ status: 200, shown: true })
      expect(during.user).toEqual({ status: 200, shown: true })
    })
    await test.step('operator temporary response contains no shell, queue or identity', async () => {
      const response = await operatorPage.request.get(URL, { timeout: 10_000 })
      const body = await response.text()
      expect(body).toMatch(/temporarily unavailable/i)
      forbidden(body)
      expect(body).not.toContain(email)
    })
    expect(
      performance.now() - started,
      'all during-stall checks finish inside the fault'
    ).toBeLessThan(STALL_MS)

    await sleep(STALL_MS + 2000)
    await test.step('outsider denial returns after recovery', async () => {
      await expect(async () => {
        for (const ctx of [user, anonymous, invented]) {
          expect((await ctx.request.get(URL, { timeout: 10_000 })).status()).toBe(404)
        }
      }).toPass({ timeout: 60_000, intervals: [2000, 5000] })
    })
    await test.step('operator board returns after recovery', async () => {
      await expect(async () => {
        await operatorPage.goto(URL)
        await expect(operatorPage.getByRole('table', { name: 'Background queues' })).toBeVisible({
          timeout: 5000,
        })
      }).toPass({ timeout: 90_000, intervals: [2000, 5000] })
    })
  } catch (error) {
    failures.push(error)
  } finally {
    const closed = await Promise.allSettled(contexts.map(async (context) => context.close()))
    for (const result of closed) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, 'Console outage checks or cleanup failed')
})
