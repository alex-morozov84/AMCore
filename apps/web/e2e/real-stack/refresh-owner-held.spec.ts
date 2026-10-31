import { expect, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import {
  ageAccessToken,
  holdRefreshInProgress,
  readEntry,
  refreshHoldActive,
  revokeBackendSessions,
  rewriteEntry,
  sessionRows,
  signedIn,
  sleep,
} from './redis-outage-support'

// A refresh the API has already received is held by locking the backend invitation handoff table,
// which only the refresh takes. Callers are refused at their own 3 s admission bound while the
// single refresh owner keeps going, and the backend sees exactly one rotation (a rotation adds one
// session row). The hold stays under the backend's 5 s transaction limit, so the refresh succeeds.
// Bounds are for this fault class on this machine, not guarantees.
test.describe.configure({ mode: 'serial' })

const HOLD_MS = 4500
const CALLER_BOUND_MS = 3000 + 1000 // 3 s contract + one HTTP round trip and scheduling

test('a running refresh survives its callers leaving and the backend rotates exactly once', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const before = (await readEntry(cookie))!
    const userId = before.userSnapshot.id
    expect(sessionRows(userId)).toBe(1)
    await rewriteEntry(cookie, ageAccessToken)

    const held = holdRefreshInProgress(HOLD_MS)
    for (let i = 0; i < 25 && !refreshHoldActive(); i++) await sleep(100)
    expect(refreshHoldActive()).toBe(true)

    // Several callers arrive while the refresh is held; every one is refused within its bound.
    const started = performance.now()
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => context.request.get('/api/auth/me', { timeout: 15_000 }))
    )
    expect(responses.map((r) => r.status())).toEqual([503, 503, 503, 503])
    expect(performance.now() - started).toBeLessThan(CALLER_BOUND_MS)

    // The callers are gone and the refresh is still held: nothing was published or rotated yet.
    expect((await readEntry(cookie))?.version).toBe(before.version)
    expect(sessionRows(userId)).toBe(1)

    await held
    // The owner finishes on its own and publishes one new version.
    await expect(async () => {
      expect((await readEntry(cookie))?.version).toBe(before.version + 1)
    }).toPass({ timeout: 15_000, intervals: [250, 500] })
    const after = (await readEntry(cookie))!
    expect(after.refreshToken).not.toBe(before.refreshToken)
    expect(sessionRows(userId)).toBe(2) // login + exactly one rotation

    // The next request is served from the published version without another rotation.
    expect((await context.request.get('/api/auth/me', { timeout: 15_000 })).status()).toBe(200)
    expect((await readEntry(cookie))?.version).toBe(after.version)
    expect(sessionRows(userId)).toBe(2)
  } finally {
    await context.close()
  }
})

// The same hold, now longer than the backend's 5 s transaction limit: the backend refresh fails
// after every caller has left. The failure happened before any rotation, so the stored session is
// untouched and the next request refreshes it normally.
test('a backend refresh that fails after its callers left keeps the session and a later request refreshes it', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const before = (await readEntry(cookie))!
    const userId = before.userSnapshot.id
    await rewriteEntry(cookie, ageAccessToken)

    const held = holdRefreshInProgress(8000)
    for (let i = 0; i < 25 && !refreshHoldActive(); i++) await sleep(100)
    expect(refreshHoldActive()).toBe(true)
    expect((await context.request.get('/api/auth/me', { timeout: 15_000 })).status()).toBe(503)

    await held
    await sleep(3000) // the owner has seen the backend failure by now
    const stored = (await readEntry(cookie))!
    expect(stored.version).toBe(before.version)
    expect(stored.refreshToken).toBe(before.refreshToken)
    expect(sessionRows(userId)).toBe(1)

    await expect(async () => {
      expect((await context.request.get('/api/auth/me', { timeout: 15_000 })).status()).toBe(200)
    }).toPass({ timeout: 20_000, intervals: [500, 1000] })
    expect((await readEntry(cookie))?.version).toBe(before.version + 1)
    expect(sessionRows(userId)).toBe(2)
  } finally {
    await context.close()
  }
})

// Explicit revocation on the backend while the vault still holds the entry: the next request is
// refused as signed out and does not resurrect the session.
test('a session revoked on the backend is refused on the next request, also with an aged entry', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000)
  const origin = activeTarget().origins.product
  const context = await browser.newContext({ baseURL })
  try {
    const cookie = await signedIn(context, origin)
    const userId = (await readEntry(cookie))!.userSnapshot.id
    revokeBackendSessions(userId)
    await rewriteEntry(cookie, ageAccessToken)

    const refused = await context.request.get('/api/auth/me', { timeout: 15_000 })
    expect(refused.status()).toBe(401)
    expect(sessionRows(userId)).toBe(1) // no rotation happened
    expect((await context.request.get('/api/auth/me', { timeout: 15_000 })).status()).toBe(401)
    expect(sessionRows(userId)).toBe(1)
  } finally {
    await context.close()
  }
})
