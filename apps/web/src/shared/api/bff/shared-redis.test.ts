// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'

import { getWebRedisClient, type WebRedisClient } from './redis-client'
import { withRedisRequestDeadline } from './redis-deadline'
import { sharedRedis } from './shared-redis'

vi.mock('server-only', () => ({}))
vi.mock('./redis-client', () => ({ getWebRedisClient: vi.fn() }))

afterEach(() => vi.useRealTimers())

function client(get = vi.fn().mockResolvedValue(null), set = vi.fn().mockResolvedValue('OK')) {
  return {
    get,
    set,
    raw: { isReady: true, withCommandOptions: () => ({ get, set }) } as unknown as WebRedisClient,
  }
}

it('dispatches zero commands when a connection becomes ready after the deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const connection = Promise.withResolvers<WebRedisClient>()
  vi.mocked(getWebRedisClient).mockReturnValue(connection.promise)
  const redis = client()
  const operation = sharedRedis().get('test')
  const refused = expect(operation).rejects.toThrow('Session vault store is unavailable')
  await vi.advanceTimersByTimeAsync(1000)
  await refused
  connection.resolve(redis.raw)
  await Promise.resolve()
  expect(redis.get).not.toHaveBeenCalled()
})

it('checks the request deadline again before a second command', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const redis = client()
  vi.mocked(getWebRedisClient).mockResolvedValue(redis.raw)
  await withRedisRequestDeadline(undefined, 10, async () => {
    const access = sharedRedis()
    await expect(access.get('test')).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(10)
    await expect(access.set('test', 'value')).rejects.toThrow('Session vault store is unavailable')
  })
  expect(redis.get).toHaveBeenCalledOnce()
  expect(redis.set).not.toHaveBeenCalled()
})

it('bounds pending connection waiters even after they time out', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const connection = Promise.withResolvers<WebRedisClient>()
  const getConnection = vi.mocked(getWebRedisClient)
  getConnection.mockClear().mockReturnValue(connection.promise)
  const redis = client()
  try {
    const waiting = Promise.allSettled(Array.from({ length: 512 }, () => sharedRedis().get('test')))
    await vi.advanceTimersByTimeAsync(1000)
    expect((await waiting).every((result) => result.status === 'rejected')).toBe(true)
    await expect(sharedRedis().get('test')).rejects.toThrow('Session vault store is unavailable')
    expect(getConnection).toHaveBeenCalledTimes(512)
    connection.resolve(redis.raw)
    await vi.advanceTimersByTimeAsync(0)
    expect(redis.get).not.toHaveBeenCalled()
    await expect(sharedRedis().get('test')).resolves.toBeNull()
    expect(redis.get).toHaveBeenCalledOnce()
  } finally {
    connection.resolve(redis.raw)
  }
})
