import type { PinoLogger } from 'nestjs-pino'

import type { RedisLockService } from '../redis'

import { SingletonCronRunner } from './singleton-cron.runner'

describe('SingletonCronRunner', () => {
  let runner: SingletonCronRunner
  let lock: jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
  let logger: jest.Mocked<PinoLogger>

  const options = { name: 'job.test', lockKey: 'lock:test', ttlMs: 1000 }

  beforeEach(() => {
    lock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    runner = new SingletonCronRunner(lock as unknown as RedisLockService, logger)
  })

  it('acquires the lock, runs the task, and releases when the lock is won', async () => {
    const task = jest.fn().mockResolvedValue(undefined)

    await runner.run(options, task)

    expect(lock.acquire).toHaveBeenCalledWith('lock:test', 1000)
    expect(task).toHaveBeenCalledTimes(1)
    expect(lock.release).toHaveBeenCalledWith('lock:test', 'lock-token')
  })

  it('skips the task and does not release when the lock is held elsewhere', async () => {
    lock.acquire.mockResolvedValue(null)
    const task = jest.fn()

    await runner.run(options, task)

    expect(task).not.toHaveBeenCalled()
    expect(lock.release).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job.test_skipped' }),
      expect.any(String)
    )
  })

  it('fails closed when acquisition throws (no task, no release, no rejection)', async () => {
    lock.acquire.mockRejectedValue(new Error('redis down'))
    const task = jest.fn()

    await expect(runner.run(options, task)).resolves.toBeUndefined()

    expect(task).not.toHaveBeenCalled()
    expect(lock.release).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job.test_lock_failed' }),
      expect.any(String)
    )
  })

  it('logs a stable event and still releases when the task throws', async () => {
    const task = jest.fn().mockRejectedValue(new Error('boom'))

    await expect(runner.run(options, task)).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job.test_failed' }),
      expect.any(String)
    )
    expect(lock.release).toHaveBeenCalledWith('lock:test', 'lock-token')
  })

  it('swallows a release failure (logs a stable event, no rejection)', async () => {
    lock.release.mockRejectedValue(new Error('release failed'))
    const task = jest.fn().mockResolvedValue(undefined)

    await expect(runner.run(options, task)).resolves.toBeUndefined()

    expect(task).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job.test_lock_release_failed' }),
      expect.any(String)
    )
  })
})
