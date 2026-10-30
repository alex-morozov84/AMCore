import { type BrowserContext, expect, test } from '@playwright/test'
import { createClient } from '@redis/client'

import { activeTarget, guardedExec } from '../support/managed-target.mjs'

import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'

// The real stack with a real backend: the session vault, the refresh owner and the binding check
// run against the stand's own Redis, which is stalled with `CLIENT PAUSE ... ALL` (commands are
// accepted but not answered until the pause ends). Timings are bounds for this fault class on this
// machine, not guarantees.
test.describe.configure({ mode: 'serial' })

// Wall-clock bound of the real stack: the 3 s admission contract is proven with a controlled clock
// in the unit tests; here one HTTP round trip and process scheduling may add up to TOLERANCE_MS.
const ADMISSION_MS = 3000
const TOLERANCE_MS = 1000
const WALL_CLOCK_BOUND_MS = ADMISSION_MS + TOLERANCE_MS

interface VaultEntry {
  version: number
  accessTokenExpiresAt: number
  refreshToken: string
  userSnapshot: { id: string }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const vaultClient = () =>
  createClient({
    url: `redis://127.0.0.1:${activeTarget().ports.redis}/0`,
    RESP: 2,
    socket: { reconnectStrategy: false, connectTimeout: 5000 },
  })

async function withVault<T>(
  work: (client: ReturnType<typeof vaultClient>) => Promise<T>
): Promise<T> {
  const client = vaultClient()
  client.on('error', () => undefined)
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.close()
  }
}

const keyOf = (cookie: string) => `web:session:v1:${cookie}`

async function readEntry(cookie: string): Promise<VaultEntry | null> {
  const raw = await withVault((client) => client.get(keyOf(cookie)))
  return raw ? (JSON.parse(raw) as VaultEntry) : null
}

/** Rewrites only this test-created entry, keeping its TTL; used to age the access token or replay a stale refresh token. */
async function rewriteEntry(
  cookie: string,
  change: (entry: VaultEntry) => VaultEntry
): Promise<void> {
  await withVault(async (client) => {
    const raw = await client.get(keyOf(cookie))
    if (!raw) throw new Error('Test session missing')
    const next = change(JSON.parse(raw) as VaultEntry)
    const result = await client.set(keyOf(cookie), JSON.stringify(next), {
      condition: 'XX',
      expiration: 'KEEPTTL',
    })
    if (result !== 'OK') throw new Error('Test session rewrite failed')
  })
}

function pauseRedis(ms: number): void {
  guardedExec('redis', 'redis-cli', 'CLIENT', 'PAUSE', String(ms), 'ALL')
}

async function signedIn(context: BrowserContext, origin: string): Promise<string> {
  const email = uniqueEmail('redis-outage')
  const registration = await browserCredentialRequest(context.request, '/api/auth/register', {
    headers: { origin },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const cookie = (await context.cookies()).find((c) => c.name === 'amcore_session')
  if (!cookie) throw new Error('Test-created cookie missing')
  expect((await context.request.get('/api/auth/me')).status()).toBe(200)
  return cookie.value
}

async function untilServed(context: BrowserContext, limitMs: number): Promise<number> {
  const started = performance.now()
  for (;;) {
    const res = await context.request.get('/api/auth/me', { timeout: 8000 }).catch(() => null)
    if (res?.status() === 200) return Math.round(performance.now() - started)
    if (performance.now() - started > limitMs) throw new Error(`not served within ${limitMs} ms`)
    await sleep(250)
  }
}

test('a stalled Redis refuses session requests within the admission budget, keeps the session and recovers', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const before = await readEntry(cookie)

    pauseRedis(7000)
    const started = performance.now()
    const refused = await context.request.get('/api/auth/me', { timeout: 15_000 })
    const elapsed = performance.now() - started
    // Observed refusal only: whether the protected backend handler was reached is not asserted.
    expect(refused.status()).toBe(503)
    expect(await refused.json()).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
    expect(elapsed).toBeLessThan(WALL_CLOCK_BOUND_MS)
    // The cookie is untouched by the failure.
    expect((await context.cookies()).find((c) => c.name === 'amcore_session')?.value).toBe(cookie)

    const recoveredAfter = await untilServed(context, 30_000)
    expect(recoveredAfter).toBeLessThan(30_000)
    const after = await readEntry(cookie)
    expect(after?.version).toBe(before?.version)
    expect(after?.refreshToken).toBe(before?.refreshToken)
  } finally {
    await context.close()
  }
})

// Narrow claim: six concurrent requests on an aged entry succeed and ONE new version appears. Owner
// count and overlap in the refresh phase are not observed here (open: held-refresh overlap control).
test('concurrent requests on an aged entry all succeed and publish exactly one new version', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const before = (await readEntry(cookie))!
    await rewriteEntry(cookie, (entry) => ({ ...entry, accessTokenExpiresAt: Date.now() - 60_000 }))

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => context.request.get('/api/auth/me', { timeout: 15_000 }))
    )
    expect(responses.map((r) => r.status())).toEqual([200, 200, 200, 200, 200, 200])
    const after = (await readEntry(cookie))!
    expect(after.version).toBe(before.version + 1)
    expect(after.refreshToken).not.toBe(before.refreshToken)
    expect(after.accessTokenExpiresAt).toBeGreaterThan(Date.now())
  } finally {
    await context.close()
  }
})

// Narrow claim: a request refused during a stall leaves the aged entry in place and it refreshes
// after recovery. An already-running refresh surviving caller departure is NOT proven here (open).
test('an aged entry survives a request refused during a stall and refreshes after recovery', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    await rewriteEntry(cookie, (entry) => ({ ...entry, accessTokenExpiresAt: Date.now() - 60_000 }))

    pauseRedis(6000)
    const started = performance.now()
    const refused = await context.request.get('/api/auth/me', { timeout: 15_000 })
    expect(refused.status()).toBe(503)
    expect(performance.now() - started).toBeLessThan(WALL_CLOCK_BOUND_MS)

    // After the stall the stored entry still exists and a new request refreshes it normally.
    await untilServed(context, 40_000)
    expect(await readEntry(cookie)).not.toBeNull()
    expect((await context.request.get('/api/auth/me')).status()).toBe(200)
  } finally {
    await context.close()
  }
})

test('a replayed stale refresh token is rejected by the backend and ends the stored session', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const first = (await readEntry(cookie))!
    await rewriteEntry(cookie, (entry) => ({ ...entry, accessTokenExpiresAt: Date.now() - 60_000 }))
    expect((await context.request.get('/api/auth/me')).status()).toBe(200)
    const rotated = (await readEntry(cookie))!
    expect(rotated.refreshToken).not.toBe(first.refreshToken)

    // Put the already-rotated token back with an expired access token: a reuse the backend detects.
    await rewriteEntry(cookie, (entry) => ({
      ...entry,
      refreshToken: first.refreshToken,
      accessTokenExpiresAt: Date.now() - 60_000,
    }))
    const rejected = await context.request.get('/api/auth/me', { timeout: 15_000 })
    expect(rejected.status()).toBe(401)
    expect(await readEntry(cookie)).toBeNull()
    expect((await context.request.get('/api/auth/me')).status()).toBe(401)
  } finally {
    await context.close()
  }
})

test('a protected page shows the temporary state during a stall, then the page again after recovery', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const page = await context.newPage()
    await page.goto('/en')
    await expect(page.getByText(/^Welcome/)).toBeVisible()

    pauseRedis(6000)
    // The navigation must complete: a failed navigation is not accepted as "not signed out".
    await page.goto('/en', { timeout: 20_000 })
    await expect(page).toHaveURL(/\/en\/?$/)
    await expect(page.getByText(/usually temporary|temporarily unavailable/i).first()).toBeVisible()
    await expect(page.getByText(/^Welcome/)).toHaveCount(0)
    expect((await context.cookies()).find((c) => c.name === 'amcore_session')?.value).toBe(cookie)

    await sleep(7000)
    await expect(async () => {
      await page.goto('/en')
      await expect(page.getByText(/^Welcome/)).toBeVisible({ timeout: 3000 })
    }).toPass({ timeout: 40_000, intervals: [1000, 3000] })
    expect(await readEntry(cookie)).not.toBeNull()
  } finally {
    await context.close()
  }
})
