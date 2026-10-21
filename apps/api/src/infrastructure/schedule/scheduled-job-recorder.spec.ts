import { failed, partial, succeeded } from './scheduled-job'
import { PendingEvidence } from './scheduled-job-pending'
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

describe('write deadlines hold even for timers set earlier', () => {
  it('writes the frequent lane no sooner than a minute after the previous write finished', async () => {
    const starts: number[] = []
    const { instance, tx, writes } = recorder()
    tx.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          starts.push(Date.now())
          writes.push({ resolve: () => resolve(), reject: () => undefined })
        })
    )
    const tick = () =>
      instance.finish(
        NOTIFICATION_RECOVERY_JOB,
        instance.begin(NOTIFICATION_RECOVERY_JOB),
        succeeded()
      )
    tick()
    await advance(0)
    expect(starts).toHaveLength(1)
    // New evidence arrives while the first write is still in flight, then the write settles late.
    tick()
    await advance(5000)
    tick()
    writes[0]?.resolve()
    const settledAt = Date.now()
    await advance(0)
    await advance(10 * 60_000)
    writes.splice(0).forEach((write) => write.resolve())
    await advance(10 * 60_000)
    for (const second of starts.slice(1)) expect(second - settledAt).toBeGreaterThanOrEqual(60_000)
  })

  it('does not let an earlier timer bypass a retry deadline that moved later', async () => {
    const { instance, tx, writes } = recorder()
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), failed('x'))
    await advance(0)
    expect(tx).toHaveBeenCalledTimes(1)
    // More evidence while the write is in flight arms a timer that keeps re-arming every second.
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), failed('y'))
    await advance(500)
    // The write fails: the retry deadline is now 5 s away, later than that earlier timer.
    writes.splice(0).forEach((write) => write.reject(new Error('db down')))
    await advance(0)
    await advance(3000)
    expect(tx).toHaveBeenCalledTimes(1)
    await advance(3000)
    expect(tx).toHaveBeenCalledTimes(2)
  })
})

describe('registration travels the managed write path', () => {
  const registerAll = (instance: ScheduledJobRecorder) =>
    instance.registerJobs([CLEANUP_JOB, NOTIFICATION_RECOVERY_JOB], () => null)

  it('is queued without waiting and is never written with a pool of one connection', async () => {
    const { instance, tx } = recorder({ max: 1, total: 1, idle: 1 })
    registerAll(instance)
    await advance(10 * 60_000)
    expect(tx).not.toHaveBeenCalled()
  })

  it('is written once, through the same single-flight writer, when a connection is free', async () => {
    const { instance, tx, writes, max } = recorder()
    registerAll(instance)
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), succeeded())
    await advance(0)
    expect(tx).toHaveBeenCalledTimes(1) // registration first; evidence waits behind it
    writes.splice(0).forEach((write) => write.resolve())
    await advance(2000)
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(max()).toBe(1)
  })

  it('is retried after a transient failure and keeps waiting evidence until then', async () => {
    const { instance, tx, writes } = recorder()
    registerAll(instance)
    instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), succeeded())
    await advance(0)
    writes.splice(0).forEach((write) => write.reject(new Error('db down')))
    await advance(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'schedule.registration_failed' }),
      expect.any(String)
    )
    await advance(6000)
    expect(tx.mock.calls.length).toBe(2) // the second attempt registers again, evidence still queued
    writes.splice(0).forEach((write) => write.resolve())
    await advance(2000)
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})

describe('memory stays bounded while the database is hung', () => {
  const pendingOf = (instance: ScheduledJobRecorder) =>
    (instance as unknown as { pending: PendingEvidence }).pending

  it('keeps a thousand finished daily runs inside the record limit', async () => {
    const { instance } = recorder()
    for (let index = 0; index < 1000; index += 1) {
      const run = instance.begin(CLEANUP_JOB)
      instance.finish(CLEANUP_JOB, run, succeeded())
      await advance(10)
    }
    const snapshot = pendingOf(instance).take('event')
    expect(snapshot.starts.length).toBeLessThanOrEqual(PendingEvidence.RECORDS_PER_JOB)
    expect(snapshot.finishes.length).toBeLessThanOrEqual(PendingEvidence.RECORDS_PER_JOB)
  })

  it('does not track a run begun while recording is degraded, nor record its finish', async () => {
    const { instance, writes } = recorder()
    for (let round = 0; round < 6; round += 1) {
      instance.finish(CLEANUP_JOB, instance.begin(CLEANUP_JOB), failed('x'))
      await advance(70_000)
      writes.splice(0).forEach((write) => write.reject(new Error('db down')))
      await advance(0)
    }
    pendingOf(instance).take('event')
    const run = instance.begin(CLEANUP_JOB)
    expect(run.tracked).toBe(false)
    instance.finish(CLEANUP_JOB, run, succeeded())
    const snapshot = pendingOf(instance).take('event')
    expect(snapshot.starts).toHaveLength(0)
    expect(snapshot.finishes).toHaveLength(0)
    expect(snapshot.dropped.get('cleanup')).toBeGreaterThan(0)
  })
})
