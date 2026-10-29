// @vitest-environment node
import { TimeoutError } from '@redis/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getWebRedisClient } from './redis-client'
import { redisVaultLock } from './session-lock'

// See ensure-fresh-session.test.ts for why `server-only` needs mocking here.
vi.mock('server-only', () => ({}))
vi.mock('./redis-client', () => ({
  getWebRedisClient: vi.fn(),
}))

function makeFakeRedis() {
  return {
    set: vi.fn(),
    eval: vi.fn(),
  }
}

describe('redisVaultLock', () => {
  let fakeRedis: ReturnType<typeof makeFakeRedis>

  beforeEach(() => {
    fakeRedis = makeFakeRedis()
    vi.mocked(getWebRedisClient).mockResolvedValue(fakeRedis as never)
  })

  it('acquire() returns a token immediately when SET NX succeeds', async () => {
    fakeRedis.set.mockResolvedValue('OK')

    const token = await redisVaultLock.acquire('s1', 5000)

    expect(token).not.toBeNull()
    expect(fakeRedis.set).toHaveBeenCalledWith(
      'web:session:v1:s1:lock',
      expect.any(String),
      expect.objectContaining({ condition: 'NX' })
    )
  })

  it('acquire() retries with jitter and eventually gives up if never free', async () => {
    vi.useFakeTimers()
    try {
      fakeRedis.set.mockResolvedValue(null) // always held

      const pending = redisVaultLock.acquire('s1', 5000)
      await vi.runAllTimersAsync()
      const token = await pending

      expect(token).toBeNull()
      expect(fakeRedis.set.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // A queue timeout is a rejection, never a silent "lock not held": acquire must not report a
  // token it does not own, and the refresh protocol must see the failure.
  it.each([
    ['acquire', () => redisVaultLock.acquire('s1', 5000), 'set'],
    ['renew', () => redisVaultLock.renew('s1', 'my-token', 5000), 'eval'],
    ['release', () => redisVaultLock.release('s1', 'my-token'), 'eval'],
  ] as const)('%s() propagates a queue timeout', async (_name, run, command) => {
    fakeRedis[command].mockRejectedValue(new TimeoutError())

    await expect(run()).rejects.toBeInstanceOf(TimeoutError)
  })

  it('release() runs the token-checked DEL script', async () => {
    fakeRedis.eval.mockResolvedValue(1)

    await redisVaultLock.release('s1', 'my-token')

    expect(fakeRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("DEL"'),
      expect.objectContaining({ keys: ['web:session:v1:s1:lock'], arguments: ['my-token'] })
    )
  })

  it('renew() returns false when the script reports the token no longer owns the lock', async () => {
    fakeRedis.eval.mockResolvedValue(0)

    await expect(redisVaultLock.renew('s1', 'stale-token', 5000)).resolves.toBe(false)
  })
})
