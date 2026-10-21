import { once } from 'node:events'

import { jest } from '@jest/globals'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue, UnrecoverableError, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import type { ProducerObserver } from '../src/infrastructure/background-work/producer-observer'
import {
  defineOrdinaryWork,
  type WorkHandler,
} from '../src/infrastructure/background-work/work-definition'
import { WorkExecutionService } from '../src/infrastructure/background-work/work-execution.service'
import { WorkReadiness } from '../src/infrastructure/background-work/work-readiness'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'

import { e2eContainerLabels } from './e2e-owned-containers'

// Rehearsal of the envelope rollout rule (docs/backend/background-work.md, "Changing the job
// envelope"): a release that adds an optional envelope key, then a rollback to the release
// before it. The new side is the real producer and executor. The old side is the executor's
// first gate as it was before the key existed: a strict schema without `correlationId` whose
// failure throws UnrecoverableError('VERSION_UNSUPPORTED').
const PREVIOUS_ENVELOPE = z.strictObject({
  protocolVersion: z.literal(1),
  incarnation: z.uuidv7(),
  jobVersion: z.number().int().positive(),
  executionPolicyVersion: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  payload: z.unknown(),
})

const definition = defineOrdinaryWork({
  id: 'rollout',
  definitionVersion: 1,
  queue: { name: 'rollout', enabled: true },
  jobs: {
    run: {
      wireVersion: 1,
      schema: z.strictObject({ n: z.number() }),
      replay: { kind: 'idempotent', policyVersion: 1 },
      project: () => ({}),
      retention: { completedMs: 3_600_000, failedMs: 86_400_000 },
    },
  },
})

describe('Job envelope rollout and rollback', () => {
  let container: StartedRedisContainer
  let queue: Queue
  let redis: Redis
  const readiness = new WorkReadiness()
  const workers: Worker[] = []
  const observer: ProducerObserver = { correlationId: () => 'req-rollout-1', enqueued: jest.fn() }
  const newProducer = () => new ManagedProducer(definition, queue, readiness, observer)
  const oldProducer = () => new ManagedProducer(definition, queue, readiness)

  const startWorker = async (
    processor: ConstructorParameters<typeof Worker>[1]
  ): Promise<Worker> => {
    const worker = new Worker('rollout', processor, {
      prefix: 'amcore',
      connection: buildBullConnection(container.getConnectionUrl()),
      autorun: false,
    })
    worker.on('error', () => undefined)
    workers.push(worker)
    await worker.waitUntilReady()
    void worker.run().catch(() => undefined)
    return worker
  }
  const newReader = (handler: WorkHandler): Parameters<typeof startWorker>[0] => {
    const execution = new WorkExecutionService(readiness)
    return (job, token) => execution.run(definition, queue, job, token!, handler)
  }
  const oldReader: Parameters<typeof startWorker>[0] = async (job) => {
    if (!PREVIOUS_ENVELOPE.safeParse(job.data).success)
      throw new UnrecoverableError('VERSION_UNSUPPORTED')
  }
  const ok: WorkHandler = { run: async () => undefined }

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    queue = new Queue('rollout', {
      prefix: 'amcore',
      connection: buildBullConnection(container.getConnectionUrl()),
    })
    queue.on('error', () => undefined)
    redis = (await queue.getBackend().client) as unknown as Redis
    readiness.open()
  }, 120_000)
  beforeEach(async () => {
    await redis.flushdb()
  })
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()))
  })
  afterAll(async () => {
    await queue?.close()
    await container?.stop()
  })

  const stored = async (jobId: string): Promise<Record<string, unknown>> =>
    JSON.parse((await redis.hget(queue.toKey(jobId), 'data'))!)

  it('rolls forward: the new reader runs jobs with and without the key', async () => {
    await oldProducer().add('run', { n: 1 }, { jobId: 'before' })
    await newProducer().add('run', { n: 2 }, { jobId: 'after' })
    expect((await stored('before')).correlationId).toBeUndefined()
    expect((await stored('after')).correlationId).toBe('req-rollout-1')

    const seen: unknown[] = []
    const worker = await startWorker(
      newReader({
        run: async (payload) => {
          seen.push(payload)
        },
      })
    )
    await new Promise<void>((resolve) => {
      worker.on('completed', () => seen.length === 2 && resolve())
    })

    expect(seen).toEqual(expect.arrayContaining([{ n: 1 }, { n: 2 }]))
  })

  it('rolls back after a drain: the old reader runs the jobs that carry no key', async () => {
    const drained = await startWorker(newReader(ok))
    const done = once(drained, 'completed')
    await newProducer().add('run', { n: 1 }, { jobId: 'drained' })
    await done
    await drained.close()

    await oldProducer().add('run', { n: 2 }, { jobId: 'old-format' })
    const old = await startWorker(oldReader)
    const [job] = (await once(old, 'completed')) as [{ id: string }]

    expect(job.id).toBe('old-format')
  })

  it('rolls back without a drain: a waiting job with the key fails terminally, with no retry', async () => {
    await newProducer().add('run', { n: 1 }, { jobId: 'undrained', attempts: 3 })
    const old = await startWorker(oldReader)
    const [job, error] = (await once(old, 'failed')) as [
      { id: string; attemptsMade: number },
      Error,
    ]

    expect(job.id).toBe('undrained')
    expect(error.message).toBe('VERSION_UNSUPPORTED')
    expect(job.attemptsMade).toBe(1)
    expect(await queue.getJobState('undrained')).toBe('failed')
  })

  it('rolls back without a drain: a delayed job with the key fails when it matures', async () => {
    await newProducer().add('run', { n: 1 }, { jobId: 'matures-later', delay: 1500, attempts: 3 })
    expect(await queue.getJobState('matures-later')).toBe('delayed')

    const old = await startWorker(oldReader)
    const [job, error] = (await once(old, 'failed')) as [{ id: string }, Error]

    expect(job.id).toBe('matures-later')
    expect(error.message).toBe('VERSION_UNSUPPORTED')
  })

  it('rolls back without a drain: a job retrying with backoff fails on the old reader', async () => {
    await newProducer().add('run', { n: 1 }, { jobId: 'retrying', attempts: 3 })
    let firstAttempt!: () => void
    const attempted = new Promise<void>((resolve) => (firstAttempt = resolve))
    const failing = await startWorker(
      newReader({
        run: async () => {
          firstAttempt()
          throw new Error('transient')
        },
      })
    )
    await attempted
    // The first attempt settles before the retry is scheduled; wait for the backoff state.
    for (let wait = 0; wait < 50 && (await queue.getJobState('retrying')) !== 'delayed'; wait++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await queue.getJobState('retrying')).toBe('delayed')
    expect((await stored('retrying')).correlationId).toBe('req-rollout-1')
    await failing.close()

    const old = await startWorker(oldReader)
    const [job, error] = (await once(old, 'failed')) as [
      { id: string; attemptsMade: number },
      Error,
    ]

    expect(job.id).toBe('retrying')
    expect(error.message).toBe('VERSION_UNSUPPORTED')
    expect(job.attemptsMade).toBe(2)
  })
})
