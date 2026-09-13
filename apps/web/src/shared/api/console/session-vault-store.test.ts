// @vitest-environment node
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/redis-client', () => ({ getWebRedisClient: vi.fn() }))

import { getWebRedisClient } from '@/shared/api/bff/redis-client'

import type { ConsoleVaultRecord } from './session-vault.types'
import { redisConsoleVaultStore } from './session-vault-store'

const fakeRedis = { eval: vi.fn(), set: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getWebRedisClient).mockResolvedValue(fakeRedis as never)
  fakeRedis.set.mockResolvedValue('OK')
  fakeRedis.eval.mockResolvedValue(1)
})

describe('redisConsoleVaultStore', () => {
  it('requires the console audience in every new entry type', () => {
    expectTypeOf<
      Parameters<typeof redisConsoleVaultStore.create>[1]
    >().toEqualTypeOf<ConsoleVaultRecord>()
  })

  it('writes outside the product session namespace', async () => {
    await redisConsoleVaultStore.create('session-1', {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: Date.now() + 60_000,
      userSnapshot: {} as never,
      audience: 'console',
    })

    expect(fakeRedis.set).toHaveBeenCalledWith(
      'web:console-session:v1:session-1',
      expect.any(String),
      expect.any(Object)
    )
  })

  it('keeps the required audience in a compare-and-set refresh write', async () => {
    await redisConsoleVaultStore.setIfVersionMatches('session-1', 1, {
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      accessTokenExpiresAt: Date.now() + 60_000,
      userSnapshot: {} as never,
      audience: 'console',
    })

    const [, options] = fakeRedis.eval.mock.calls[0] as [string, { arguments: string[] }]
    expect(JSON.parse(options.arguments[1])).toMatchObject({ audience: 'console', version: 2 })
  })
})
