import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { jest } from '@jest/globals'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { PrismaClient } from '../src/generated/prisma/client'
import { readJobSnapshot } from '../src/infrastructure/background-work/job-snapshot'
import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import { applyIdempotentCommand } from '../src/infrastructure/background-work/scripts/idempotent-command'
import { defineOrdinaryWork } from '../src/infrastructure/background-work/work-definition'
import { WorkExecutionService } from '../src/infrastructure/background-work/work-execution.service'
import { WorkReadiness } from '../src/infrastructure/background-work/work-readiness'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'

import { ImageFixtureHandler, imageWork } from './fixtures/background-work/image-fixture'
import { migrateTestDatabase } from './helpers'

describe('Idempotent image conformance — two actual workers and one business output', () => {
  let postgres: StartedPostgreSqlContainer
  let broker: StartedRedisContainer
  let db: PrismaClient
  let queue: Queue
  let redis: Redis
  let producer: ManagedProducer<typeof imageWork>
  let execution: WorkExecutionService
  const workers: Worker[] = []

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:18-alpine').start()
    broker = await new RedisContainer('redis:7-alpine').start()
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgres.getConnectionUri() }),
    })
    await db.$connect()
    await migrateTestDatabase(postgres.getConnectionUri())
    await db.$executeRawUnsafe(
      await readFile(
        resolve(import.meta.dirname, '../../../docs/backend/recipes/image-work.sql'),
        'utf8'
      )
    )
    queue = new Queue('image', {
      prefix: 'amcore',
      connection: buildBullConnection(broker.getConnectionUrl()),
    })
    queue.on('error', () => undefined)
    redis = (await queue.getBackend().client) as unknown as Redis
    const readiness = new WorkReadiness()
    readiness.open()
    producer = new ManagedProducer(imageWork, queue, readiness)
    execution = new WorkExecutionService(readiness)
  }, 120_000)

  beforeEach(async () => {
    await redis.flushdb()
    await db.$executeRaw`TRUNCATE core.image_fixture_outputs`
  })
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()))
  })
  afterAll(async () => {
    await queue?.close()
    await db?.$disconnect()
    await Promise.all([postgres?.stop(), broker?.stop()])
  }, 60_000)

  function worker(handler: ImageFixtureHandler, stalled = false): Worker {
    const instance = new Worker(
      'image',
      async (job, token) => execution.run(imageWork, queue, job, token!, handler),
      {
        prefix: 'amcore',
        connection: buildBullConnection(broker.getConnectionUrl()),
        autorun: false,
        ...(stalled ? { skipLockRenewal: true, lockDuration: 3000, stalledInterval: 250 } : {}),
      }
    )
    instance.on('error', () => undefined)
    workers.push(instance)
    return instance
  }

  async function start(instances: Worker[]): Promise<void> {
    await Promise.all(instances.map((instance) => instance.waitUntilReady()))
    for (const instance of instances) void instance.run().catch(() => undefined)
  }

  async function oneOutput() {
    const result =
      await db.$queryRaw`SELECT business_request_id, transform_version, output_reference FROM core.image_fixture_outputs`
    expect(result).toEqual([
      {
        business_request_id: 'source-v1',
        transform_version: 1,
        output_reference: 'fixture-output:source-v1:1',
      },
    ])
    expect(await db.backgroundEffectEvidence.count()).toBe(0)
  }

  it('runs a naturally idempotent cache deletion without framework PG after boot', async () => {
    const cacheWork = defineOrdinaryWork({
      id: 'cache-proof',
      definitionVersion: 1,
      queue: { name: 'image', enabled: true },
      jobs: {
        clear: {
          wireVersion: 1,
          schema: z.strictObject({ cacheKey: z.literal('proof') }),
          replay: { kind: 'idempotent', policyVersion: 1 },
          project: ({ cacheKey }) => ({ cacheKey }),
          retention: { completedMs: 3600000, failedMs: 86400000 },
        },
      },
    })
    const readiness = new WorkReadiness()
    readiness.open()
    const cacheProducer = new ManagedProducer(cacheWork, queue, readiness)
    const key = 'business:cache:proof'
    await redis.set(key, 'cached')
    const query = jest.spyOn(db, '$queryRaw').mockRejectedValue(new Error('PG unavailable'))
    const write = jest.spyOn(db, '$executeRaw').mockRejectedValue(new Error('PG unavailable'))
    const instance = new Worker(
      'image',
      async (job, token) =>
        execution.run(cacheWork, queue, job, token!, { run: async () => redis.del(key) }),
      {
        prefix: 'amcore',
        connection: buildBullConnection(broker.getConnectionUrl()),
        autorun: false,
      }
    )
    instance.on('error', () => undefined)
    workers.push(instance)
    try {
      const completed = once(instance, 'completed')
      await cacheProducer.add('clear', { cacheKey: 'proof' }, { jobId: 'cache-clear', attempts: 1 })
      await start([instance])
      await completed
      expect(await redis.get(key)).toBeNull()
      expect(await redis.hget(queue.toKey('cache-clear'), 'amAutoStartsUsed')).toBe('1')
      expect(query).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    } finally {
      query.mockRestore()
      write.mockRestore()
    }
    expect(await db.backgroundEffectEvidence.count()).toBe(0)
  })

  it('fails the image business operation on its own PG dependency without framework execution evidence', async () => {
    const query = jest
      .spyOn(db, '$queryRaw')
      .mockRejectedValue(new Error('Business PG unavailable'))
    const instance = worker(new ImageFixtureHandler(db))
    try {
      const failed = once(instance, 'failed')
      await producer.add(
        'render',
        { businessRequestId: 'source-v1', transformVersion: 1 },
        {
          jobId: 'business-outage',
          attempts: 1,
        }
      )
      await start([instance])
      const [, error] = await failed
      expect(error.message).toBe('TRANSIENT_FAILURE')
      expect(query).toHaveBeenCalledTimes(1)
      expect(await redis.hget(queue.toKey('business-outage'), 'amAutoStartsUsed')).toBe('1')
    } finally {
      query.mockRestore()
    }
    expect(await db.$queryRaw`SELECT * FROM core.image_fixture_outputs`).toEqual([])
    expect(await db.backgroundEffectEvidence.count()).toBe(0)
  })

  it('replays after a post-commit lost-ack fault with two workers but commits exactly one output', async () => {
    const handler = new ImageFixtureHandler(db, async (call) => {
      if (call === 1) throw new Error('Injected post-commit acknowledgement loss')
    })
    const pair = [worker(handler), worker(handler)]
    const completed = Promise.race(pair.map((instance) => once(instance, 'completed')))
    await producer.add(
      'render',
      { businessRequestId: 'source-v1', transformVersion: 1 },
      { jobId: 'image-job', attempts: 2 }
    )
    await start(pair)
    await completed
    await oneOutput()
    expect(handler.calls).toBe(2)
    expect(handler.references).toEqual(['fixture-output:source-v1:1', 'fixture-output:source-v1:1'])
    expect(await redis.hget(queue.toKey('image-job'), 'amAutoStartsUsed')).toBe('2')
  })

  it('lets the second worker reclaim a real stall while a late first worker cannot duplicate output', async () => {
    let committed!: () => void
    let release!: () => void
    const firstCommitted = new Promise<void>((resolve) => {
      committed = resolve
    })
    const firstRelease = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = new ImageFixtureHandler(db, async (call) => {
      if (call === 1) {
        committed()
        await firstRelease
      } else release()
    })
    const first = worker(handler, true)
    const second = worker(handler, true)
    await producer.add(
      'render',
      { businessRequestId: 'source-v1', transformVersion: 1 },
      { jobId: 'image-job', attempts: 3 }
    )
    const completed = once(second, 'completed')
    try {
      await start([first])
      await firstCommitted
      await redis.del(`${queue.toKey('image-job')}:lock`)
      await start([second])
      await completed
      await oneOutput()
      expect(handler.calls).toBe(2)
      expect(handler.references).toEqual([
        'fixture-output:source-v1:1',
        'fixture-output:source-v1:1',
      ])
      expect(await redis.hget(queue.toKey('image-job'), 'amAutoStartsUsed')).toBe('2')
    } finally {
      release()
    }
  })

  it('spends one lifetime manual grant while the business key deduplicates both actual workers', async () => {
    const handler = new ImageFixtureHandler(db, async () => {
      throw new Error('Injected lost acknowledgement')
    })
    const identity = await producer.add(
      'render',
      { businessRequestId: 'source-v1', transformVersion: 1 },
      { jobId: 'image-job', attempts: 1 }
    )
    const first = worker(handler)
    const failed = once(first, 'failed')
    await start([first])
    await failed
    await first.close()
    const observation = await readJobSnapshot(redis, queue, identity.jobId)
    if (observation.status !== 'observed') throw new Error('Expected terminal snapshot')
    expect(observation.snapshot.state).toBe('failed')
    const second = worker(handler)
    const manualFailed = once(second, 'failed')
    expect(
      await applyIdempotentCommand(redis, queue, {
        id: identity.jobId,
        incarnation: identity.incarnation,
        operation: 'retry',
        fingerprint: observation.snapshot.fingerprint,
        wireVersion: 2,
        policyVersion: 1,
        admittedAt: Date.now(),
        dispatchNotAfter: Date.now() + 5000,
        commandId: uuidv7(),
        dispatchId: uuidv7(),
      })
    ).toEqual({ status: 'applied' })
    await start([second])
    await manualFailed
    await oneOutput()
    expect(handler.calls).toBe(2)
    expect(handler.references).toEqual(['fixture-output:source-v1:1', 'fixture-output:source-v1:1'])
    expect(
      await redis.hmget(queue.toKey(identity.jobId), 'amAutoStartsUsed', 'amManualGrant')
    ).toEqual(['1', 'spent'])
    const terminal = await readJobSnapshot(redis, queue, identity.jobId)
    if (terminal.status !== 'observed') throw new Error('Expected manual terminal snapshot')
    expect(
      await applyIdempotentCommand(redis, queue, {
        id: identity.jobId,
        incarnation: identity.incarnation,
        operation: 'retry',
        fingerprint: terminal.snapshot.fingerprint,
        wireVersion: 2,
        policyVersion: 1,
        admittedAt: Date.now(),
        dispatchNotAfter: Date.now() + 5000,
        commandId: uuidv7(),
        dispatchId: uuidv7(),
      })
    ).toEqual({ status: 'rejected', reason: 'MANUAL_GRANT_SPENT' })
  })

  it('keeps the business output and stored reference across hash removal and a recycled ID', async () => {
    const handler = new ImageFixtureHandler(db)
    const pair = [worker(handler), worker(handler)]
    const completed = () =>
      Promise.race(
        pair.map((instance) => once(instance, 'completed', { signal: AbortSignal.timeout(15000) }))
      )
    const firstComplete = completed()
    const first = await producer.add(
      'render',
      { businessRequestId: 'source-v1', transformVersion: 1 },
      { jobId: 'image-job', attempts: 1 }
    )
    await start(pair)
    await firstComplete
    const old = await readJobSnapshot(redis, queue, first.jobId)
    if (old.status !== 'observed') throw new Error('Expected original incarnation')
    await (await queue.getJob(first.jobId))!.remove()
    const nextComplete = completed()
    const next = await producer.add(
      'render',
      { businessRequestId: 'source-v1', transformVersion: 1 },
      { jobId: first.jobId, attempts: 1, delay: 1000 }
    )
    expect(next.incarnation).not.toBe(first.incarnation)
    expect(
      await applyIdempotentCommand(redis, queue, {
        id: first.jobId,
        incarnation: first.incarnation,
        operation: 'cancel',
        fingerprint: old.snapshot.fingerprint,
        wireVersion: 2,
        policyVersion: 1,
        admittedAt: Date.now(),
        dispatchNotAfter: Date.now() + 5000,
        commandId: uuidv7(),
        dispatchId: uuidv7(),
      })
    ).toEqual({ status: 'rejected', reason: 'STATE_CHANGED' })
    await nextComplete
    await oneOutput()
    expect(handler.references).toEqual(['fixture-output:source-v1:1', 'fixture-output:source-v1:1'])
  })

  it('normalizes a retained wire-v1 payload through the public recipe on an actual worker', async () => {
    const handler = new ImageFixtureHandler(db)
    const pair = [worker(handler), worker(handler)]
    const identity = await producer.add(
      'render',
      { businessRequestId: 'source-v1', transformVersion: 1 },
      { jobId: 'image-job', attempts: 1 }
    )
    const data = JSON.parse((await redis.hget(queue.toKey(identity.jobId), 'data'))!)
    await redis.hset(
      queue.toKey(identity.jobId),
      'data',
      JSON.stringify({ ...data, jobVersion: 1, payload: { businessKey: 'source-v1' } })
    )
    const completed = Promise.race(
      pair.map((instance) => once(instance, 'completed', { signal: AbortSignal.timeout(15000) }))
    )
    await start(pair)
    await completed
    await oneOutput()
    expect(handler.references).toEqual(['fixture-output:source-v1:1'])
  })

  it('commits one output for concurrent incarnations on two actual workers', async () => {
    let release!: () => void
    const bothCommitted = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = new ImageFixtureHandler(db, async (call) => {
      if (call === 1) await bothCommitted
      else release()
    })
    const pair = [worker(handler), worker(handler)]
    const completed = Promise.all(
      pair.map((instance) => once(instance, 'completed', { signal: AbortSignal.timeout(15000) }))
    )
    try {
      const first = await producer.add(
        'render',
        { businessRequestId: 'source-v1', transformVersion: 1 },
        { jobId: 'image-first', attempts: 1 }
      )
      const second = await producer.add(
        'render',
        { businessRequestId: 'source-v1', transformVersion: 1 },
        { jobId: 'image-second', attempts: 1 }
      )
      expect(first.incarnation).not.toBe(second.incarnation)
      await start(pair)
      await completed
      await oneOutput()
      expect(handler.references).toEqual([
        'fixture-output:source-v1:1',
        'fixture-output:source-v1:1',
      ])
    } finally {
      release()
    }
  })
})
