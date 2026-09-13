// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/redis-client', () => ({ getWebRedisClient: vi.fn() }))

import { getWebRedisClient } from '@/shared/api/bff/redis-client'

import { redisConsoleVaultStore } from './session-vault-store'

const fakeRedis = { set: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getWebRedisClient).mockResolvedValue(fakeRedis as never)
  fakeRedis.set.mockResolvedValue('OK')
})

describe('redisConsoleVaultStore', () => {
  it('writes outside the product session namespace', async () => {
    await redisConsoleVaultStore.create('session-1', {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: Date.now() + 60_000,
      userSnapshot: {} as never,
    })

    expect(fakeRedis.set).toHaveBeenCalledWith(
      'web:console-session:v1:session-1',
      expect.any(String),
      expect.any(Object)
    )
  })
})
