// @vitest-environment node
import { TimeoutError } from '@redis/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionVaultUnavailableError } from './errors'
import { redisVaultLock } from './session-lock'
import { runVaultRedis } from './vault-redis/vault-redis'

// See ensure-fresh-session.test.ts for why `server-only` needs mocking here.
vi.mock('server-only', () => ({}))
vi.mock('./vault-redis/vault-redis', () => ({ runVaultRedis: vi.fn() }))

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
    vi.mocked(runVaultRedis).mockImplementation(((op: (c: unknown, s: AbortSignal) => unknown) =>
      op(fakeRedis, new AbortController().signal)) as never)
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
  // token it does not own, and the refresh protocol must see the failure (as the typed
  // unavailable error, with the cause kept).
  it.each([
    ['acquire', () => redisVaultLock.acquire('s1', 5000), 'set'],
    ['renew', () => redisVaultLock.renew('s1', 'my-token', 5000), 'eval'],
  ] as const)(
    '%s() reports a queue timeout as the vault unavailable error',
    async (_name, run, command) => {
      fakeRedis[command].mockRejectedValue(new TimeoutError())

      const error = await run().catch((e: unknown) => e)

      expect(error).toBeInstanceOf(SessionVaultUnavailableError)
      expect((error as Error).cause).toBeInstanceOf(TimeoutError)
    }
  )

  it('release() is cleanup: a failure never rejects and is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fakeRedis.eval.mockRejectedValue(new TimeoutError())

    await expect(redisVaultLock.release('s1', 'my-token')).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('an acquire attempt with an unknown answer releases its own token', async () => {
    fakeRedis.set.mockRejectedValueOnce(new TimeoutError())
    fakeRedis.eval.mockResolvedValue(1)

    await expect(redisVaultLock.acquire('s1', 5000)).rejects.toBeInstanceOf(
      SessionVaultUnavailableError
    )
    await vi.waitFor(() => expect(fakeRedis.eval).toHaveBeenCalledTimes(1))
    const token = (fakeRedis.set.mock.calls[0] as unknown[])[1]
    expect(fakeRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("DEL"'),
      expect.objectContaining({ arguments: [token] })
    )
  })

  it('acquire() gives up once its own deadline has passed', async () => {
    vi.useFakeTimers()
    fakeRedis.set.mockResolvedValue(null)
    const pending = redisVaultLock.acquire('s1', 5000, { deadlineMs: 500 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toBeNull()
    vi.useRealTimers()
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
