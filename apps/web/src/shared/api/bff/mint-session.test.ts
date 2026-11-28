// @vitest-environment node
import type { UserResponse } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

import { testAccessToken } from './access-token.testkit'
import { mintSession } from './mint-session'
import { FakeVaultStore } from './test-fakes'

const at2Token = testAccessToken('at-2', 2_000_000_000_000)

const at1Token = testAccessToken('at-1', 2_000_000_000_000)

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

const user = { id: 'u1' } as unknown as UserResponse

describe('mintSession', () => {
  it('creates a vault entry keyed by a fresh opaque session id and returns it with the user', async () => {
    const store = new FakeVaultStore()

    const { sessionId, user: returnedUser } = await mintSession(
      { accessToken: at1Token, refreshToken: 'rt-1', user },
      store
    )

    expect(sessionId).toMatch(/^[\w-]{20,}$/)
    expect(returnedUser).toBe(user)
    await expect(store.get(sessionId)).resolves.toMatchObject({
      accessToken: at1Token,
      refreshToken: 'rt-1',
      userSnapshot: user,
      version: 1,
    })
  })

  it.each([5, 15, 30])('stores the issued expiry for a %i-minute token', async (minutes) => {
    const store = new FakeVaultStore()
    const issuedAt = 1_600_000_000_000
    const expiresAt = issuedAt + minutes * 60_000

    const { sessionId } = await mintSession(
      { accessToken: testAccessToken('issued', expiresAt), refreshToken: 'rt-1', user },
      store
    )

    const entry = await store.get(sessionId)
    expect(entry?.accessTokenExpiresAt).toBe(expiresAt)
  })

  it('does not create a vault entry for a token without usable expiry', async () => {
    const store = new FakeVaultStore()
    const create = vi.spyOn(store, 'create')
    await expect(
      mintSession({ accessToken: 'opaque', refreshToken: 'rt-1', user }, store)
    ).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('mints a different session id on every call', async () => {
    const store = new FakeVaultStore()
    const first = await mintSession({ accessToken: at1Token, refreshToken: 'rt-1', user }, store)
    const second = await mintSession({ accessToken: at2Token, refreshToken: 'rt-2', user }, store)

    expect(first.sessionId).not.toBe(second.sessionId)
  })
})
