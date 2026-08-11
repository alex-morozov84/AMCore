// @vitest-environment node
import type { UserResponse } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionVaultUnavailableError } from './errors'
import { getWebRedisClient } from './redis-client'
import type { VaultEntry } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

// See ensure-fresh-session.test.ts for why `server-only` needs mocking here.
vi.mock('server-only', () => ({}))
vi.mock('./redis-client', () => ({
  getWebRedisClient: vi.fn(),
}))

function makeFakeRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  }
}

const entry: Omit<VaultEntry, 'version'> = {
  refreshToken: 'rt-1',
  accessToken: 'at-1',
  accessTokenExpiresAt: Date.now() + 60_000,
  userSnapshot: {} as unknown as UserResponse,
}

describe('redisVaultStore', () => {
  let fakeRedis: ReturnType<typeof makeFakeRedis>

  beforeEach(() => {
    fakeRedis = makeFakeRedis()
    vi.mocked(getWebRedisClient).mockResolvedValue(fakeRedis as never)
  })

  it('get() returns null on a cache miss without touching the vault-unavailable path', async () => {
    fakeRedis.get.mockResolvedValue(null)

    await expect(redisVaultStore.get('s1')).resolves.toBeNull()
  })

  it('get() parses the stored JSON entry', async () => {
    fakeRedis.get.mockResolvedValue(JSON.stringify({ ...entry, version: 3 }))

    await expect(redisVaultStore.get('s1')).resolves.toMatchObject({
      accessToken: 'at-1',
      version: 3,
    })
  })

  it('get() wraps a Redis failure in SessionVaultUnavailableError (fail closed)', async () => {
    fakeRedis.get.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(redisVaultStore.get('s1')).rejects.toBeInstanceOf(SessionVaultUnavailableError)
  })

  it('create() writes version 1 with a TTL', async () => {
    fakeRedis.set.mockResolvedValue('OK')

    await redisVaultStore.create('s1', entry)

    expect(fakeRedis.set).toHaveBeenCalledWith(
      'web:session:v1:s1',
      expect.stringContaining('"version":1'),
      expect.objectContaining({ expiration: { type: 'EX', value: expect.any(Number) } })
    )
  })

  it('setIfVersionMatches() returns true when the CAS script reports success', async () => {
    fakeRedis.eval.mockResolvedValue(1)

    await expect(redisVaultStore.setIfVersionMatches('s1', 2, entry)).resolves.toBe(true)
    expect(fakeRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('cjson.decode'),
      expect.objectContaining({
        keys: ['web:session:v1:s1'],
        arguments: expect.arrayContaining(['2']),
      })
    )
  })

  it('setIfVersionMatches() returns false when the CAS script reports a version mismatch', async () => {
    fakeRedis.eval.mockResolvedValue(0)

    await expect(redisVaultStore.setIfVersionMatches('s1', 2, entry)).resolves.toBe(false)
  })

  it('delete() removes the key', async () => {
    fakeRedis.del.mockResolvedValue(1)

    await redisVaultStore.delete('s1')

    expect(fakeRedis.del).toHaveBeenCalledWith('web:session:v1:s1')
  })
})
