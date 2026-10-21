import { failed, partial, succeeded } from './scheduled-job'
import { ScheduledJobRecorder } from './scheduled-job-recorder'
import { CLEANUP_JOB, NOTIFICATION_RECOVERY_JOB } from './scheduled-jobs.catalogue'

import type { PrismaService } from '@/prisma'

interface Pool {
  max: number
  total: number
  idle: number
  waiting: number
}

/**
 * A database whose transactions are held until the test settles them: this is how the physical
 * bound of the recorder is observed (one write in flight, no hot retry loop, no wait for the job).
 */
function fakeDatabase(pool: Partial<Pool> = {}) {
  const writes: { resolve: () => void; reject: (error: Error) => void }[] = []
  let inFlight = 0
  let maxInFlight = 0
  const stats: Pool = { max: 10, total: 2, idle: 2, waiting: 0, ...pool }
  const prisma = {
    poolStats: () => stats,
    $transaction: jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          writes.push({
            resolve: () => {
              inFlight -= 1
              resolve()
            },
            reject: (error: Error) => {
              inFlight -= 1
              reject(error)
            },
          })
        })
    ),
  }
  return {
    prisma: prisma as unknown as PrismaService,
    writes,
    stats,
    tx: prisma.$transaction,
    max: () => maxInFlight,
  }
}

const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-21T09:00:00.000Z') })
  jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

function recorder(pool?: Partial<Pool>) {
  const db = fakeDatabase(pool)
  const instance = new ScheduledJobRecorder(db.prisma, logger as never)
  return { instance, ...db }
}

describe('begin and finish never wait for the database', () => {
  it('return at once while a write is held in flight, and the job run is unaffected', async () => {
    const { instance, tx } = recorder()
    const run = instance.begin(NOTIFICATION_RECOVERY_JOB)
    instance.finish(NOTIFICATION_RECOVERY_JOB, run, succeeded())
    await advance(0)
    expect(tx).toHaveBeenCalledTimes(1) // first frequent flush is immediate, and it hangs
    // The next 200 ticks complete synchronously although the write never settles.
    for (let tick = 0; tick < 200; tick += 1) {
      const next = instance.begin(NOTIFICATION_RECOVERY_JOB)
      instance.finish(NOTIFICATION_RECOVERY_JOB, next, succeeded())
    }
    expect(tx).toHaveBeenCalledTimes(1)
  })
})

describe('one physical write at a time', () => {
  it('never starts a second transaction while one is hung, then writes what accumulated', async () => {
    const { instance, tx, writes, max } = recorder()
    instance.finish(
      NOTIFICATION_RECOVERY_JOB,
      instance.begin(NOTIFICATION_RECOVERY_JOB),
      succeeded()
    )
    const daily = instance.begin(CLEANUP_JOB)
    instance.finish(CLEANUP_JOB, daily, partial('bucket_failed'))
    await advance(120_000)
    expect(tx).toHaveBeenCalledTimes(1)
    expect(max()).toBe(1)
    writes[0]?.resolve()
    await advance(1000)
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(max()).toBe(1)
  })

  it('writes the frequent lane at most once a minute however many ticks pass', async () => {
    const { instance, tx, writes } = recorder()
    for (let minute = 0; minute < 10; minute += 1) {
      for (let tick = 0; tick < 2; tick += 1)
        instance.finish(
          NOTIFICATION_RECOVERY_JOB,
          instance.begin(NOTIFICATION_RECOVERY_JOB),
          succeeded()
        )
      await advance(30_000)
      await advance(30_000)
      writes.splice(0).forEach((write) => write.resolve())
      await advance(0)
    }
    expect(tx.mock.calls.length).toBeLessThanOrEqual(11)
  })

  it('does not carry a frequent patch inside a daily flush: the lanes stay separate', async () => {
    const { instance, tx, writes } = recorder()
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), succeeded())
    await advance(0)
    writes[0]?.resolve()
    await advance(0)
    instance.finish(
      NOTIFICATION_RECOVERY_JOB,
      instance.begin(NOTIFICATION_RECOVERY_JOB),
      succeeded()
    )
    await advance(1000)
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('pool admission', () => {
  it('never writes with a pool of one connection', async () => {
    const { instance, tx } = recorder({ max: 1, total: 1, idle: 1 })
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), succeeded())
    await advance(10 * 60_000)
    expect(tx).not.toHaveBeenCalled()
  })

  it('never takes a connection somebody is already waiting for', async () => {
    const { instance, tx, stats } = recorder({ waiting: 3, idle: 0, total: 10 })
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), succeeded())
    await advance(60_000)
    expect(tx).not.toHaveBeenCalled()
    stats.waiting = 0
    stats.idle = 1
    await advance(120_000)
    expect(tx).toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('backs off after a failed write instead of retrying in a hot loop', async () => {
    const { instance, tx, writes } = recorder()
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), failed('x'))
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await advance(1000)
      writes.splice(0).forEach((write) => write.reject(new Error('db down')))
      await advance(0)
    }
    // 40 seconds of outage: attempts at ~0, 5, 15, 35 s (5 s doubling) — never one a second.
    expect(tx.mock.calls.length).toBeLessThanOrEqual(6)
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps a failure it could not write and writes it after the database is back', async () => {
    const { instance, tx, writes } = recorder()
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), failed('kept'))
    await advance(0)
    writes.splice(0).forEach((write) => write.reject(new Error('db down')))
    await advance(10_000)
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(2)
    writes.splice(0).forEach((write) => write.resolve())
    await advance(0)
    const before = tx.mock.calls.length
    await advance(120_000)
    expect(tx.mock.calls.length).toBe(before) // everything was written once; nothing left pending
  })

  it('goes degraded after repeated failures: only failures and partial runs are kept', async () => {
    const { instance, tx, writes } = recorder()
    for (let round = 0; round < 6; round += 1) {
      instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), failed('x'))
      await advance(70_000)
      writes.splice(0).forEach((write) => write.reject(new Error('db down')))
      await advance(0)
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'schedule.recorder_degraded' }),
      expect.any(String)
    )
    const calls = tx.mock.calls.length
    // While degraded, a success is dropped (counted) instead of queued.
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), succeeded())
    await advance(1000)
    expect(tx.mock.calls.length).toBe(calls)
  })
})
