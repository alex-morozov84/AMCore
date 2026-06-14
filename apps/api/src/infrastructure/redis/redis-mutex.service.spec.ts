import type { PinoLogger } from 'nestjs-pino'

import type { RedisLockService } from './redis-lock.service'
import { LockUnavailableError, type MutexOptions, RedisMutexService } from './redis-mutex.service'

const OPTIONS: MutexOptions = {
  ttlMs: 9000,
  renewMs: 3000,
  attempts: 5,
  retryDelayMs: 10,
}

describe('RedisMutexService', () => {
  let lock: jest.Mocked<Pick<RedisLockService, 'acquireBlocking' | 'renew' | 'release'>>
  let logger: jest.Mocked<Pick<PinoLogger, 'setContext' | 'warn'>>
  let service: RedisMutexService

  beforeEach(() => {
    lock = {
      acquireBlocking: jest.fn().mockResolvedValue('token-1'),
      renew: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    }
    logger = { setContext: jest.fn(), warn: jest.fn() }
    service = new RedisMutexService(
      lock as unknown as RedisLockService,
      logger as unknown as PinoLogger
    )
  })

  it('acquires, runs the section, and releases the lock', async () => {
    const result = await service.runExclusive('k', OPTIONS, async () => 'value')

    expect(result).toBe('value')
    expect(lock.acquireBlocking).toHaveBeenCalledWith('k', OPTIONS.ttlMs, {
      attempts: OPTIONS.attempts,
      retryDelayMs: OPTIONS.retryDelayMs,
    })
    expect(lock.release).toHaveBeenCalledWith('k', 'token-1')
  })

  it('fails closed with LockUnavailableError when the lock stays held', async () => {
    lock.acquireBlocking.mockResolvedValue(null)

    await expect(service.runExclusive('k', OPTIONS, async () => 'value')).rejects.toBeInstanceOf(
      LockUnavailableError
    )
    expect(lock.release).not.toHaveBeenCalled()
  })

  it('fails closed with LockUnavailableError when Redis is unreachable (acquire throws)', async () => {
    lock.acquireBlocking.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(service.runExclusive('k', OPTIONS, async () => 'value')).rejects.toBeInstanceOf(
      LockUnavailableError
    )
    expect(lock.release).not.toHaveBeenCalled()
  })

  it('releases the lock even when the section throws', async () => {
    await expect(
      service.runExclusive('k', OPTIONS, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(lock.release).toHaveBeenCalledWith('k', 'token-1')
  })

  it('renews the lease in the background while the section runs', async () => {
    jest.useFakeTimers()
    try {
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      const run = service.runExclusive('k', OPTIONS, async () => {
        await pending
        return 'done'
      })

      await jest.advanceTimersByTimeAsync(OPTIONS.renewMs)
      expect(lock.renew).toHaveBeenCalledWith('k', 'token-1', OPTIONS.ttlMs)

      finish()
      await expect(run).resolves.toBe('done')
    } finally {
      jest.useRealTimers()
    }
  })
})
