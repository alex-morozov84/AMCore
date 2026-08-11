// @vitest-environment node
import type { UserResponse } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

import { mintSession } from './mint-session'
import { FakeVaultStore } from './test-fakes'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

const user = { id: 'u1' } as unknown as UserResponse

describe('mintSession', () => {
  it('creates a vault entry keyed by a fresh opaque session id and returns it with the user', async () => {
    const store = new FakeVaultStore()

    const { sessionId, user: returnedUser } = await mintSession(
      { accessToken: 'at-1', refreshToken: 'rt-1', user },
      store
    )

    expect(sessionId).toMatch(/^[\w-]{20,}$/)
    expect(returnedUser).toBe(user)
    await expect(store.get(sessionId)).resolves.toMatchObject({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      userSnapshot: user,
      version: 1,
    })
  })

  it('sets accessTokenExpiresAt to roughly 15 minutes from now', async () => {
    const store = new FakeVaultStore()
    const before = Date.now()

    const { sessionId } = await mintSession(
      { accessToken: 'at-1', refreshToken: 'rt-1', user },
      store
    )

    const entry = await store.get(sessionId)
    expect(entry?.accessTokenExpiresAt).toBeGreaterThan(before + 14 * 60 * 1000)
    expect(entry?.accessTokenExpiresAt).toBeLessThanOrEqual(before + 15 * 60 * 1000 + 1000)
  })

  it('mints a different session id on every call', async () => {
    const store = new FakeVaultStore()
    const first = await mintSession({ accessToken: 'at-1', refreshToken: 'rt-1', user }, store)
    const second = await mintSession({ accessToken: 'at-2', refreshToken: 'rt-2', user }, store)

    expect(first.sessionId).not.toBe(second.sessionId)
  })
})
