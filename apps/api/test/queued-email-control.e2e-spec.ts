import { once } from 'node:events'
import { performance } from 'node:perf_hooks'

import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { DelayedError, Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { PinoLogger } from 'nestjs-pino'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { EnvService } from '../src/env/env.service'
import { type Prisma, PrismaClient } from '../src/generated/prisma/client'
import { ControlConnection } from '../src/infrastructure/background-work/control-connection'
import { managedProcessor } from '../src/infrastructure/background-work/managed-processor'
import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import { PgOutcomeBuffer } from '../src/infrastructure/background-work/pg-outcome-buffer'
import { preparedBody } from '../src/infrastructure/background-work/prepared-body.store'
import { ProviderEvidenceStore } from '../src/infrastructure/background-work/provider-evidence.store'
import { PROVIDER_WINDOW_CLOCK } from '../src/infrastructure/background-work/provider-window-clock'
import { initializeManagedQueue } from '../src/infrastructure/background-work/scripts/initialize-queue'
import { PROVIDER_DEFER_LUA } from '../src/infrastructure/background-work/scripts/provider-defer.lua'
import { PROVIDER_FENCE_LUA } from '../src/infrastructure/background-work/scripts/provider-fence.lua'
import {
  defineOrdinaryWork,
  type WorkHandler,
} from '../src/infrastructure/background-work/work-definition'
import { WorkExecutionService } from '../src/infrastructure/background-work/work-execution.service'
import { WorkFailure } from '../src/infrastructure/background-work/work-failure'
import { WorkReadiness } from '../src/infrastructure/background-work/work-readiness'
import type { EmailProvider } from '../src/infrastructure/email/email.types'
import { EmailTemplate } from '../src/infrastructure/email/email.types'
import { emailWork } from '../src/infrastructure/email/email.work'
import { MockEmailProvider } from '../src/infrastructure/email/providers/mock.provider'
import { QueuedEmailExecution } from '../src/infrastructure/email/queued-email-execution'
import type { MetricsService } from '../src/infrastructure/observability'
import { DEFAULT_JOB_OPTIONS } from '../src/infrastructure/queue/interfaces/job-options.interface'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'
import type { PrismaService } from '../src/prisma'

import { migrateTestDatabase } from './helpers'

const definition = defineOrdinaryWork({
  id: 'email-fixture',
  definitionVersion: 1,
  queue: { name: 'email-fixture', enabled: true },
  jobs: {
    send: {
      wireVersion: 1,
      schema: z.strictObject({ reference: z.string() }),
      replay: { kind: 'provider-window', policyVersion: 1, recipe: 'queued-email' },
      project: (payload: { reference: string }) => ({ reference: payload.reference }),
      retention: { completedMs: 3600000, failedMs: 86400000 },
    },
  },
})

describe('Queued-email immutable request and independent provider evidence', () => {
  let postgres: StartedPostgreSqlContainer
  let broker: StartedRedisContainer
  let prisma: PrismaClient
  let queue: Queue
  let redis: Redis
  let readiness: WorkReadiness
  let evidence: ProviderEvidenceStore
  let control: ControlConnection
  let buffer: PgOutcomeBuffer
  const workers: Worker[] = []

  beforeAll(async () => {
    // Sequential starts leave every successful resource available to teardown on setup failure.
    postgres = await new PostgreSqlContainer('postgres:18-alpine').start()
    broker = await new RedisContainer('redis:7-alpine').start()
    await migrateTestDatabase(postgres.getConnectionUri())
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgres.getConnectionUri() }),
    })
    await prisma.$connect()
    evidence = new ProviderEvidenceStore(prisma as PrismaService)
    control = new ControlConnection(
      new EnvService(new ConfigService({ REDIS_URL: broker.getConnectionUrl() }))
    )
    readiness = new WorkReadiness()
    readiness.open()
    queue = new Queue('email-fixture', {
      prefix: 'amcore',
      connection: buildBullConnection(broker.getConnectionUrl()),
    })
    queue.on('error', () => undefined)
    redis = (await queue.getBackend().client) as unknown as Redis
  }, 120_000)
  beforeEach(async () => {
    await redis.flushdb()
    await prisma.backgroundEffectEvidence.deleteMany()
    await prisma.backgroundBudget.deleteMany()
    buffer = new PgOutcomeBuffer()
  })
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()))
    buffer.onModuleDestroy()
  })
  afterAll(async () => {
    await queue?.close()
    await prisma?.$disconnect()
    await broker?.stop()
    await postgres?.stop()
  }, 60_000)

  it.each([
    {
      name: 'opposite initial/current offsets: horizon equality',
      gap: 98000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      calls: 0,
      reason: 'HORIZON_EXPIRED',
    },
    {
      name: 'opposite initial/current offsets: horizon plus 1ms',
      gap: 98001,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      calls: 1,
    },
    {
      name: 'worker upper bound wins at equality',
      gap: 98000,
      initial: -2000,
      pg: -2000,
      broker: -2000,
      wall: 2000,
      calls: 0,
      reason: 'CLOCK_UNCERTAIN',
      refences: 1,
    },
    {
      name: 'worker upper bound wins with 1ms remaining',
      gap: 98001,
      initial: -2000,
      pg: -2000,
      broker: -2000,
      wall: 2000,
      calls: 1,
    },
    {
      name: 'Redis upper bound wins with 1ms remaining',
      gap: 98001,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: -2000,
      calls: 1,
    },
    {
      name: 'freshness 999ms',
      gap: 99001,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      age: 999,
      calls: 1,
    },
    {
      name: 'inclusive freshness 1000ms',
      gap: 99001,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      age: 1000,
      calls: 1,
    },
    {
      name: 'stale twice at 1001ms',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      age: 1001,
      calls: 0,
      reason: 'CLOCK_UNCERTAIN',
    },
    {
      name: 'same-attempt fresh refence after 1001ms',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      age: 1001,
      freshRefence: true,
      calls: 1,
    },
    {
      name: 'floor cannot call 1ms early after offset change',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      floorOffset: -2000,
      advance: -1,
      calls: 0,
      reason: 'DEFERRED',
    },
    {
      name: 'inclusive real floor after offset change',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      floorOffset: -2000,
      advance: 0,
      calls: 1,
    },
    {
      name: 'opposite floor offsets remain conservative at 7999ms',
      gap: 200000,
      initial: 2000,
      pg: -2000,
      broker: -2000,
      wall: -2000,
      floorOffset: 2000,
      advance: 7999,
      calls: 0,
      reason: 'DEFERRED',
    },
    {
      name: 'opposite floor offsets admit at 8000ms',
      gap: 200000,
      initial: 2000,
      pg: -2000,
      broker: -2000,
      wall: -2000,
      floorOffset: 2000,
      advance: 8000,
      calls: 1,
    },
    {
      name: 'ambiguous applied broker fence',
      gap: 200000,
      initial: -2000,
      pg: 0,
      broker: 0,
      wall: 0,
      ambiguous: true,
      calls: 0,
      reason: 'WORK_UNAVAILABLE',
    },
    {
      name: 'failed same-attempt PG refence',
      gap: 200000,
      initial: -2000,
      pg: 0,
      broker: 0,
      wall: 0,
      age: 1001,
      failRefence: true,
      calls: 0,
      reason: 'INJECTED_REFENCE_FAILURE',
    },
    {
      name: 'absolute date floor 1ms early',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      floorOffset: -2000,
      absolute: true,
      advance: -1,
      calls: 0,
      reason: 'DEFERRED',
    },
    {
      name: 'absolute date floor equality',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      floorOffset: -2000,
      absolute: true,
      calls: 1,
    },
    {
      name: 'Retry-After beyond 24h remains beyond horizon',
      gap: 200000,
      initial: -2000,
      pg: 0,
      broker: 0,
      wall: 0,
      floorOffset: 0,
      duration: 86400001,
      calls: 0,
      reason: 'HORIZON_EXPIRED',
    },
    {
      name: 'unsupported Retry-After never grants another possible call',
      gap: 200000,
      initial: -2000,
      pg: 0,
      broker: 0,
      wall: 0,
      unsupported: true,
      calls: 0,
      reason: 'CLOCK_UNCERTAIN',
    },
    {
      name: 'elapsed rounding 999.01ms remains within ceiling',
      gap: 99001,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      age: 999.01,
      calls: 1,
    },
    {
      name: 'elapsed rounding 1000.01ms is stale',
      gap: 200000,
      initial: -2000,
      pg: 2000,
      broker: 2000,
      wall: 2000,
      age: 1000.01,
      calls: 0,
      reason: 'CLOCK_UNCERTAIN',
    },
    {
      name: 'PG/Redis skew beyond contract',
      gap: 200000,
      initial: -2000,
      pg: -2000,
      broker: 2000,
      wall: 2000,
      calls: 0,
      reason: 'CLOCK_UNCERTAIN',
    },
  ])(
    'runs an actual worker with independent clock injection: $name',
    async (example) => {
      // Only clock sources are injected: real PG transactions, Redis Lua predicates,
      // stock worker claims and the production email execution/transport owners run.
      const producer = new ManagedProducer(definition, queue, readiness)
      const identity = await producer.add('send', { reference: 'clock-fixture' }, { attempts: 3 })
      const anchor = Date.now()
      let elapsed = example.advance ?? 0
      let phase: 'initial' | 'floor' | 'current' = 'initial'
      const pgNow = (): number =>
        phase === 'initial'
          ? anchor - PROVIDER_WINDOW_CLOCK.providerDedupHorizonMs + example.gap + example.initial
          : phase === 'floor'
            ? anchor - 60000 + (example.floorOffset ?? 0)
            : anchor + elapsed + example.pg
      const clockedDb = new Proxy(prisma, {
        get(target, property) {
          if (property !== '$transaction') return Reflect.get(target, property)
          return <T>(
            action: (tx: Prisma.TransactionClient) => Promise<T>,
            options?: { timeout?: number; maxWait?: number }
          ) =>
            target.$transaction(
              (tx) =>
                action(
                  new Proxy(tx, {
                    get(transaction, key) {
                      if (key !== '$queryRaw') return Reflect.get(transaction, key)
                      return (parts: TemplateStringsArray, ...values: unknown[]) =>
                        parts.join('').trim() === 'SELECT clock_timestamp() AS now'
                          ? Promise.resolve([{ now: new Date(pgNow()) }])
                          : transaction.$queryRaw(parts, ...values)
                    },
                  })
                ),
              options
            )
        },
      })
      const clockedEvidence = new ProviderEvidenceStore(clockedDb as unknown as PrismaService)
      const rawWithClient = control.withClient.bind(control)
      const lease = jest.spyOn(control, 'withClient').mockImplementation((action) =>
        rawWithClient((client) =>
          action(
            new Proxy(client, {
              get(target, property) {
                if (property !== 'eval') {
                  const value = Reflect.get(target, property)
                  return typeof value === 'function' ? value.bind(target) : value
                }
                return (script: string, keys: number, ...args: (string | number)[]) => {
                  const loseReply = example.ambiguous && script === PROVIDER_FENCE_LUA
                  if (script === PROVIDER_FENCE_LUA || script === PROVIDER_DEFER_LUA) {
                    const sample = Math.floor(anchor + elapsed + example.broker)
                    script = script.replace(
                      "local time = redis.call('TIME')",
                      `local time = {'${Math.floor(sample / 1000)}','${(sample % 1000) * 1000}'}`
                    )
                  }
                  const result = target.eval(script, keys, ...args)
                  return loseReply
                    ? result.then(() => {
                        throw new Error('INJECTED_FENCE_REPLY_LOSS')
                      })
                    : result
                }
              },
            })
          )
        )
      )
      const wall = jest
        .spyOn(Date, 'now')
        .mockImplementation(() => Math.floor(anchor + elapsed + example.wall))
      const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => 10000 + elapsed)
      let calls = 0
      let entrances = 0
      let storedDeadline = 0
      let storedFirst = 0
      let finishedAt = 0
      let executionFailure: string | undefined
      const refences = jest.spyOn(clockedEvidence, 'refence')
      if (example.failRefence) refences.mockRejectedValue(new Error('INJECTED_REFENCE_FAILURE'))
      const email: EmailProvider = {
        send: async () => {
          throw new Error('DIRECT_SEND_FORBIDDEN')
        },
        sendPrepared: async () => {
          throw new Error('DIRECT_SEND_FORBIDDEN')
        },
        queuedEmail: {
          provider: 'mock',
          recipeVersion: 1,
          scope: () => 'a'.repeat(64),
          send: async (body, key, _signal, beforeTransport) => {
            elapsed += example.freshRefence && entrances > 0 ? 0 : (example.age ?? 0)
            entrances += 1
            beforeTransport()
            if (body !== '{"frozen":true}' || key !== `email:${identity.incarnation}`)
              throw new Error('FROZEN_REQUEST_CHANGED')
            calls += 1
            // Virtual time covers the complete accepted S1s/T30s hard allowances.
            elapsed += 31000
            finishedAt = anchor + elapsed
            return { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
          },
        },
      }
      const policy = new QueuedEmailExecution(email, clockedEvidence, control, buffer, readiness)
      const execution = new WorkExecutionService(readiness, policy)
      let done!: () => void
      const ran = new Promise<void>((resolve) => {
        done = resolve
      })
      const worker = new Worker(
        queue.name,
        async (job, token) => {
          try {
            const frozen = await rawWithClient((client) =>
              preparedBody(
                client,
                queue,
                job.id!,
                {
                  incarnation: identity.incarnation,
                  lockToken: token!,
                  providerScope: 'a'.repeat(64),
                },
                '{"frozen":true}'
              )
            )
            if (frozen.status !== 'prepared') throw new Error('PREPARATION_FAILED')
            const seed = await clockedEvidence.reserve({
              workId: definition.id,
              incarnation: identity.incarnation,
              jobId: identity.jobId,
              queueEpoch: (await redis.hget(queue.toKey('meta'), 'amQueueEpoch'))!,
              jobName: 'send',
              wireVersion: 1,
              policyVersion: 1,
              automaticLimit: 3,
              requestDigest: frozen.digest,
              providerScope: frozen.providerScope,
            })
            if ('accepted' in seed) throw new Error('INVALID_SEED')
            storedDeadline = seed.row.nominalDeadline!.getTime()
            storedFirst = seed.row.firstDispatchAt!.getTime()
            if (example.floorOffset !== undefined) phase = 'floor'
            await clockedEvidence.finalize(
              seed,
              {
                certainty: 'none',
                code: 'NO_CALL',
                ...(example.unsupported
                  ? { retryAfter: { kind: 'unsupported' as const } }
                  : example.floorOffset !== undefined
                    ? {
                        retryAfter: example.absolute
                          ? { kind: 'absolute' as const, timestamp: anchor + example.floorOffset }
                          : { kind: 'duration' as const, milliseconds: example.duration ?? 60000 },
                      }
                    : {}),
              },
              {
                incarnation: identity.incarnation,
                attemptId: seed.attemptId,
                kind: 'denied-before-call',
              }
            )
            phase = 'current'
            await execution.run(definition, queue, job, token!, {
              prepareRequest: async () => {
                throw new Error('REQUEST_RERENDERED')
              },
              run: async (_payload, invocation) => {
                await invocation.effect!.send()
              },
            })
          } catch (error) {
            executionFailure = error instanceof DelayedError ? 'DEFERRED' : (error as Error).message
            throw error
          } finally {
            done()
          }
        },
        {
          prefix: 'amcore',
          connection: buildBullConnection(broker.getConnectionUrl()),
          autorun: false,
        }
      )
      workers.push(worker)
      worker.on('error', () => undefined)
      try {
        void worker.run().catch(() => undefined)
        await ran
        await worker.pause()
        expect(calls).toBe(example.calls)
        expect(executionFailure).toBe(example.reason)
        const row = await evidence.read(definition.id, identity.incarnation)
        expect(row?.nominalDeadline?.getTime()).toBe(storedDeadline)
        expect(row?.firstDispatchAt?.getTime()).toBe(storedFirst)
        expect(row?.manualGrant).toBe('none')
        expect(row?.autoStartsUsed).toBeLessThanOrEqual(2)
        expect(refences.mock.calls.length).toBe(
          example.refences ?? ((example.age ?? 0) > 1000 ? 1 : 0)
        )
        expect(row?.outcomeRecorded).toBe(!example.failRefence)
        expect(row?.certainty).toBe(
          example.failRefence ? 'unknown' : example.calls ? 'accepted' : 'none'
        )
        for (const [attempt] of refences.mock.calls) {
          expect(attempt.row.firstDispatchAt?.getTime()).toBe(storedFirst)
          expect(attempt.row.nominalDeadline?.getTime()).toBe(storedDeadline)
          expect(attempt.row.autoStartsUsed).toBe(2)
          expect(await redis.hget(queue.toKey(identity.jobId), 'amEffectAttempt')).toBe(
            attempt.attemptId
          )
        }
        if (example.calls === 1) {
          if (storedDeadline - example.initial - finishedAt <= 59000)
            throw new Error('RESERVED_SAFETY_MARGIN_LOST')
        }
      } finally {
        lease.mockRestore()
        wall.mockRestore()
        monotonic.mockRestore()
        refences.mockRestore()
      }
    },
    30000
  )

  it('completes legacy and enveloped secret-bearing jobs before validation/render/provider admission', async () => {
    let businessCalls = 0
    const email: EmailProvider = {
      send: async () => {
        businessCalls += 1
        throw new Error('FORBIDDEN')
      },
      sendPrepared: async () => {
        businessCalls += 1
        throw new Error('FORBIDDEN')
      },
    }
    const observeEmailOperation = jest.fn()
    const recipe = new QueuedEmailExecution(email, evidence, control, buffer, readiness, {
      observeEmailOperation,
    } as unknown as MetricsService)
    const execution = new WorkExecutionService(readiness, recipe)
    const handler: WorkHandler = {
      prepareRequest: async () => {
        businessCalls += 1
        throw new Error('FORBIDDEN')
      },
      run: async () => {
        businessCalls += 1
        throw new Error('FORBIDDEN')
      },
    }
    const Host = managedProcessor(definition)
    const host = new Host(queue, execution, { get: () => handler })
    const worker = new Worker(queue.name, (job, token) => host.process(job, token), {
      prefix: 'amcore',
      connection: buildBullConnection(broker.getConnectionUrl()),
      autorun: false,
    })
    workers.push(worker)
    const completed = new Promise<void>((resolve, reject) => {
      let count = 0
      worker.on('completed', () => {
        if (++count === 2) resolve()
      })
      worker.on('failed', (_job, error) => reject(error))
      worker.on('error', reject)
    })
    const secret = { template: EmailTemplate.PASSWORD_RESET, data: { token: 'secret-fixture...' } }
    await queue.add('send', secret, { jobId: 'legacy-secret' })
    await queue.add(
      'send',
      {
        protocolVersion: 1,
        incarnation: uuidv7(),
        jobVersion: 999,
        executionPolicyVersion: 1,
        createdAt: Date.now(),
        payload: secret,
      },
      { jobId: 'enveloped-secret' }
    )
    void worker.run().catch(() => undefined)
    await completed
    expect(businessCalls).toBe(0)
    expect(await prisma.backgroundEffectEvidence.count()).toBe(0)
    expect(await prisma.backgroundBudget.count()).toBe(0)
    expect(observeEmailOperation).toHaveBeenCalledTimes(2)
    for (const [labels] of observeEmailOperation.mock.calls)
      expect(labels).toMatchObject({
        operation: 'process',
        result: 'discarded',
        retryable: 'false',
      })
    expect(await (await queue.getJob('legacy-secret'))!.getState()).toBe('completed')
    expect(await (await queue.getJob('enveloped-secret'))!.getState()).toBe('completed')
  })

  it('adopts only a first-start legacy WELCOME and quarantines previously started work without rendering or sending it', async () => {
    const legacyDefinition = { ...emailWork, queue: { ...emailWork.queue!, name: queue.name } }
    await initializeManagedQueue(redis, queue.toKey('meta'))
    let renders = 0
    const requests: string[] = []
    const provider: EmailProvider = {
      send: async () => {
        throw new Error('FORBIDDEN')
      },
      sendPrepared: async () => {
        throw new Error('FORBIDDEN')
      },
      queuedEmail: {
        provider: 'mock',
        recipeVersion: 1,
        scope: () => 'a'.repeat(64),
        send: async (_body, key, _signal, beforeTransport) => {
          beforeTransport()
          requests.push(key)
          return { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
        },
      },
    }
    const policy = new QueuedEmailExecution(provider, evidence, control, buffer, readiness)
    policy.onModuleInit()
    const execution = new WorkExecutionService(readiness, policy)
    const handler: WorkHandler = {
      prepareRequest: async () => {
        renders += 1
        return '{"fixture":true}'
      },
      run: async (_payload, invocation) => {
        await invocation.effect!.send()
      },
    }
    const Host = managedProcessor(legacyDefinition)
    const host = new Host(queue, execution, { get: () => handler })
    const worker = new Worker(queue.name, (job, token) => host.process(job, token), {
      prefix: 'amcore',
      connection: buildBullConnection(broker.getConnectionUrl()),
      autorun: false,
    })
    workers.push(worker)
    const outcomes = new Promise<Map<string, string>>((resolve, reject) => {
      const states = new Map<string, string>()
      const record = (id: string, result: string) => {
        states.set(id, result)
        if (states.size === 4) resolve(states)
      }
      worker.on('completed', (job) => record(job.id!, 'completed'))
      worker.on('failed', (job, error) => record(job!.id!, error.message))
      worker.on('error', reject)
    })
    const payload = {
      template: EmailTemplate.WELCOME,
      to: 'legacy@example.test',
      data: { name: 'Legacy', email: 'legacy@example.test' },
    }
    await queue.add('send-email', payload, { ...DEFAULT_JOB_OPTIONS, jobId: 'legacy-fresh' })
    await queue.add('send-email', payload, { ...DEFAULT_JOB_OPTIONS, jobId: 'legacy-started' })
    await redis.hset(queue.toKey('legacy-started'), 'ats', '1')
    await queue.add(
      'send-email',
      { template: EmailTemplate.WELCOME },
      { ...DEFAULT_JOB_OPTIONS, jobId: 'legacy-malformed' }
    )
    await queue.add('send-email', payload, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: 'legacy-unsupported',
      backoff: { type: 'fixed', delay: 1000 },
    })
    const unsupportedBefore = await redis.hmget(queue.toKey('legacy-unsupported'), 'data', 'opts')
    void worker.run().catch(() => undefined)
    expect(await outcomes).toEqual(
      new Map([
        ['legacy-fresh', 'completed'],
        ['legacy-started', 'EFFECT_UNKNOWN'],
        ['legacy-malformed', 'PERMANENT_FAILURE'],
        ['legacy-unsupported', 'CONTENT_UNSUPPORTED'],
      ])
    )
    expect(renders).toBe(1)
    const fresh = (await queue.getJob('legacy-fresh'))!
    expect(requests).toEqual([`email:${fresh.data.incarnation}`])
    expect(await evidence.read('email', fresh.data.incarnation)).toMatchObject({
      certainty: 'accepted',
      autoStartsUsed: 1,
    })
    const started = (await queue.getJob('legacy-started'))!
    expect(await evidence.read('email', started.data.incarnation)).toMatchObject({
      certainty: 'unknown',
      unresolvedCount: 1,
      firstDispatchAt: null,
      nominalDeadline: null,
      requestDigest: null,
      providerScope: null,
      manualGrant: 'none',
      safeResult: {
        code: 'LEGACY_REQUEST_UNKNOWN',
        legacyAttemptsStarted: 2,
        retryClockSupported: false,
      },
    })
    expect(await redis.hmget(queue.toKey('legacy-unsupported'), 'data', 'opts')).toEqual(
      unsupportedBefore
    )
    expect(await redis.hget(queue.toKey('legacy-unsupported'), 'amIncarnation')).toBeNull()
    expect(await prisma.backgroundEffectEvidence.count()).toBe(2)
  })

  it('refuses legacy uncertainty quota exhaustion before changing its broker request or calling business code', async () => {
    const legacyDefinition = { ...emailWork, queue: { ...emailWork.queue!, name: queue.name } }
    await initializeManagedQueue(redis, queue.toKey('meta'))
    await prisma.backgroundBudget.create({
      data: {
        key: 'global',
        evidenceRows: 50000,
        evidenceBytes: 64n * 1024n * 1024n,
        lastObservedTime: new Date(),
      },
    })
    let calls = 0
    const email: EmailProvider = {
      send: async () => {
        calls += 1
        throw new Error('FORBIDDEN')
      },
      sendPrepared: async () => {
        calls += 1
        throw new Error('FORBIDDEN')
      },
    }
    const recipe = new QueuedEmailExecution(email, evidence, control, buffer, readiness)
    const execution = new WorkExecutionService(readiness, recipe)
    const handler: WorkHandler = {
      prepareRequest: async () => {
        calls += 1
        throw new Error('FORBIDDEN')
      },
      run: async () => {
        calls += 1
        throw new Error('FORBIDDEN')
      },
    }
    const Host = managedProcessor(legacyDefinition)
    const host = new Host(queue, execution, { get: () => handler })
    const worker = new Worker(queue.name, (job, token) => host.process(job, token), {
      prefix: 'amcore',
      connection: buildBullConnection(broker.getConnectionUrl()),
      autorun: false,
    })
    workers.push(worker)
    const failed = once(worker, 'failed')
    await queue.add(
      'send-email',
      {
        template: EmailTemplate.WELCOME,
        to: 'legacy@example.test',
        data: { name: 'Legacy', email: 'legacy@example.test' },
      },
      { ...DEFAULT_JOB_OPTIONS, jobId: 'legacy-quota', attempts: 1 }
    )
    await redis.hset(queue.toKey('legacy-quota'), 'ats', '1')
    const before = await redis.hmget(queue.toKey('legacy-quota'), 'data', 'opts')
    void worker.run().catch(() => undefined)
    await failed
    expect(await redis.hmget(queue.toKey('legacy-quota'), 'data', 'opts')).toEqual(before)
    expect(
      await redis.hmget(
        queue.toKey('legacy-quota'),
        'amIncarnation',
        'amEvidenceInitialized',
        'amLegacyRequestUnknown'
      )
    ).toEqual([null, null, null])
    expect(await prisma.backgroundEffectEvidence.count()).toBe(0)
    expect(calls).toBe(0)
  })

  it('leaves control slots available during four concurrent render/provider waits with the real mock recipe', async () => {
    const env = new EnvService(new ConfigService({ REDIS_URL: broker.getConnectionUrl() }))
    const mock = new MockEmailProvider(
      { setContext: () => undefined, info: () => undefined } as unknown as PinoLogger,
      env,
      control
    )
    let rendered = 0
    let sent = 0
    let allRendering!: () => void
    let releaseRender!: () => void
    let allTransporting!: () => void
    let releaseTransport!: () => void
    const rendering = new Promise<void>((resolve) => {
      allRendering = resolve
    })
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    const transporting = new Promise<void>((resolve) => {
      allTransporting = resolve
    })
    const transportGate = new Promise<void>((resolve) => {
      releaseTransport = resolve
    })
    const provider: EmailProvider = {
      send: mock.send.bind(mock),
      sendPrepared: mock.sendPrepared.bind(mock),
      queuedEmail: {
        ...mock.queuedEmail!,
        send: async (...args) => {
          const result = await mock.queuedEmail!.send(...args)
          if (++sent === 4) allTransporting()
          await transportGate
          return result
        },
      },
    }
    const policy = new QueuedEmailExecution(provider, evidence, control, buffer, readiness)
    policy.onModuleInit()
    const execution = new WorkExecutionService(readiness, policy)
    const handler: WorkHandler = {
      prepareRequest: async (payload) => {
        if (++rendered === 4) allRendering()
        await renderGate
        return JSON.stringify(payload)
      },
      run: async (_payload, context) => context.effect!.send(),
    }
    const producer = new ManagedProducer(definition, queue, readiness)
    const completed: Promise<unknown>[] = []
    for (let index = 0; index < 4; index++) {
      await producer.add(
        'send',
        { reference: `lease-${index}` },
        { jobId: `lease-${index}`, attempts: 1 }
      )
      const worker = new Worker(
        'email-fixture',
        (job, token) => execution.run(definition, queue, job, token!, handler),
        {
          prefix: 'amcore',
          connection: buildBullConnection(broker.getConnectionUrl()),
          autorun: false,
        }
      )
      worker.on('error', () => undefined)
      workers.push(worker)
      completed.push(once(worker, 'completed'))
    }
    let rejectFailure!: (error: Error) => void
    const failure = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject
    })
    // A failed worker must release the test gates; Jest timeout alone cannot
    // unwind an awaited phase or clean a processor still holding a test latch.
    const timeout = setTimeout(
      () => rejectFailure(new Error(`LEASE_PROOF_TIMEOUT:rendered=${rendered},sent=${sent}`)),
      10000
    )
    for (const worker of workers) {
      worker.on('failed', (job, error) =>
        rejectFailure(new Error(`LEASE_PROOF_FAILED:${job?.id}:${error.message}`))
      )
      void worker.run().catch(rejectFailure)
    }
    try {
      await Promise.race([rendering, failure])
      expect(await control.withClient((client) => client.ping())).toBe('PONG')
      releaseRender()
      await Promise.race([transporting, failure])
      expect(await control.withClient((client) => client.ping())).toBe('PONG')
      releaseTransport()
      await Promise.race([Promise.all(completed), failure])
      expect(sent).toBe(4)
      expect(
        await prisma.backgroundEffectEvidence.count({
          where: {
            certainty: 'accepted',
            outcomeRecorded: true,
          },
        })
      ).toBe(4)
    } finally {
      clearTimeout(timeout)
      releaseRender()
      releaseTransport()
    }
  }, 30000)

  it('defers an early automatic Retry-After claim without spending another possible call', async () => {
    const calls: number[] = []
    const bodies: string[] = []
    let renders = 0
    const observeEmailOperation = jest.fn()
    const email: EmailProvider = {
      send: async () => {
        throw new Error('DIRECT_SEND_FORBIDDEN')
      },
      sendPrepared: async () => {
        throw new Error('DIRECT_SEND_FORBIDDEN')
      },
      queuedEmail: {
        provider: 'mock',
        recipeVersion: 1,
        scope: () => 'a'.repeat(64),
        send: async (body, _key, _signal, beforeTransport) => {
          beforeTransport()
          calls.push(Date.now())
          bodies.push(body)
          return calls.length === 1
            ? {
                certainty: 'none',
                retryable: true,
                code: 'RATE_LIMITED',
                retryAfter: { kind: 'duration', milliseconds: 10 },
              }
            : { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
        },
      },
    }
    const policy = new QueuedEmailExecution(email, evidence, control, buffer, readiness, {
      observeEmailOperation,
    } as unknown as MetricsService)
    policy.onModuleInit()
    const execution = new WorkExecutionService(readiness, policy)
    const handler: WorkHandler = {
      prepareRequest: async () => {
        renders += 1
        return '{"cooldown":true}'
      },
      run: async (_payload, invocation) => invocation.effect!.send(),
    }
    const identity = await new ManagedProducer(definition, queue, readiness).add(
      'send',
      { reference: 'cooldown' },
      { jobId: 'cooldown', attempts: 2 }
    )
    const worker = new Worker(
      queue.name,
      (job, token) => execution.run(definition, queue, job, token!, handler),
      {
        prefix: 'amcore',
        connection: buildBullConnection(broker.getConnectionUrl()),
        autorun: false,
      }
    )
    workers.push(worker)
    let claims = 0
    let secondClaim!: () => void
    const claimedEarly = new Promise<void>((resolve) => {
      secondClaim = resolve
    })
    worker.on('active', () => {
      if (++claims === 2) secondClaim()
    })
    const completed = once(worker, 'completed')
    void worker.run().catch(() => undefined)
    await claimedEarly
    expect(calls).toHaveLength(1)
    expect(await evidence.read(definition.id, identity.incarnation)).toMatchObject({
      autoStartsUsed: 1,
      activeAttemptId: null,
      certainty: 'none',
    })
    await completed
    expect(claims).toBeGreaterThanOrEqual(3)
    expect(calls).toHaveLength(2)
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(4010)
    expect(bodies).toEqual(['{"cooldown":true}', '{"cooldown":true}'])
    expect(renders).toBe(1)
    expect(await evidence.read(definition.id, identity.incarnation)).toMatchObject({
      autoStartsUsed: 2,
      certainty: 'accepted',
      manualGrant: 'none',
    })
    expect(observeEmailOperation.mock.calls.map(([labels]) => labels)).toEqual([
      expect.objectContaining({ result: 'error', retryable: 'true' }),
      expect.objectContaining({ result: 'success' }),
    ])
  }, 30000)

  it.each([
    ['before-call', 'none', true, 0],
    ['after-unknown', 'unknown', true, 1],
    ['after-accepted', 'accepted', false, 1],
  ] as const)(
    'keeps provider certainty independent of a typed diagnosis %s',
    async (mode, certainty, permanent, expectedCalls) => {
      const work = defineOrdinaryWork({
        id: definition.id,
        definitionVersion: 1,
        queue: definition.queue,
        jobs: definition.jobs,
        failureReasons: { handler_failure: { title: { en: 'A known handler failure' } } },
      })
      let calls = 0
      const email: EmailProvider = {
        send: async () => {
          throw new Error('DIRECT_SEND_FORBIDDEN')
        },
        sendPrepared: async () => {
          throw new Error('DIRECT_SEND_FORBIDDEN')
        },
        queuedEmail: {
          provider: 'mock',
          recipeVersion: 1,
          scope: () => 'a'.repeat(64),
          send: async (_body, _key, _signal, beforeTransport) => {
            beforeTransport()
            calls++
            return {
              certainty: certainty === 'accepted' ? 'accepted' : 'unknown',
              retryable: false,
              code: certainty === 'accepted' ? 'COMPLETED' : 'TRANSIENT_FAILURE',
            }
          },
        },
      }
      const policy = new QueuedEmailExecution(email, evidence, control, buffer, readiness)
      policy.onModuleInit()
      const execution = new WorkExecutionService(readiness, policy)
      const handler: WorkHandler = {
        prepareRequest: async () => '{"immutable":true}',
        run: async (_payload, invocation) => {
          if (mode !== 'before-call') await invocation.effect!.send()
          throw new WorkFailure('handler_failure', { permanent })
        },
      }
      const identity = await new ManagedProducer(work, queue, readiness).add(
        'send',
        { reference: mode },
        { jobId: mode, attempts: 1 }
      )
      const worker = new Worker(
        queue.name,
        (job, token) => execution.run(work, queue, job, token!, handler),
        {
          prefix: 'amcore',
          connection: buildBullConnection(broker.getConnectionUrl()),
          autorun: false,
        }
      )
      workers.push(worker)
      const failed = once(worker, 'failed')
      void worker.run().catch(() => undefined)
      const [, error] = await failed
      expect(error.message).toBe(permanent ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE')
      expect(calls).toBe(expectedCalls)
      expect(await evidence.read(work.id, identity.incarnation)).toMatchObject({
        certainty,
        outcomeRecorded: true,
        unresolvedCount: certainty === 'unknown' ? 1 : 0,
      })
      expect(
        JSON.parse((await redis.hget(queue.toKey(identity.jobId), 'amMetadata'))!)
      ).toMatchObject({ report: 'failure', failureCode: 'handler_failure' })
    }
  )

  it.each([
    ['body', 'REQUEST_EXPIRED'],
    ['scope', 'PROVIDER_CHANGED'],
    ['evidence', 'OUTCOME_UNRECORDED'],
  ] as const)(
    'refuses a second provider call after protected %s is lost or changed',
    async (fault, reason) => {
      let calls = 0
      let renders = 0
      let scope = 'a'.repeat(64)
      const email: EmailProvider = {
        send: async () => {
          throw new Error('DIRECT_SEND_FORBIDDEN')
        },
        sendPrepared: async () => {
          throw new Error('DIRECT_SEND_FORBIDDEN')
        },
        queuedEmail: {
          provider: 'mock',
          recipeVersion: 1,
          scope: () => scope,
          send: async (_body, _key, _signal, beforeTransport) => {
            beforeTransport()
            calls += 1
            return { certainty: 'unknown', retryable: true, code: 'TRANSIENT_FAILURE' }
          },
        },
      }
      const policy = new QueuedEmailExecution(email, evidence, control, buffer, readiness)
      policy.onModuleInit()
      const execution = new WorkExecutionService(readiness, policy)
      const handler: WorkHandler = {
        prepareRequest: async () => {
          renders += 1
          return '{"immutable":true}'
        },
        run: async (_payload, invocation) => invocation.effect!.send(),
      }
      const producer = new ManagedProducer(definition, queue, readiness)
      const identity = await producer.add(
        'send',
        { reference: fault },
        { jobId: `protected-${fault}`, attempts: 2 }
      )
      const worker = new Worker(
        queue.name,
        (job, token) => execution.run(definition, queue, job, token!, handler),
        {
          prefix: 'amcore',
          connection: buildBullConnection(broker.getConnectionUrl()),
          autorun: false,
        }
      )
      workers.push(worker)
      const terminal = new Promise<Error>((resolve, reject) => {
        worker.on('completed', () => reject(new Error('UNEXPECTED_COMPLETION')))
        worker.on('error', reject)
        worker.on('failed', (job, error) => {
          if (job!.attemptsMade === 2) {
            resolve(error)
            return
          }
          void (async () => {
            await worker.pause(true)
            const beforeFault = await evidence.read(definition.id, identity.incarnation)
            if (
              beforeFault?.certainty !== 'unknown' ||
              beforeFault.unresolvedCount !== 1 ||
              beforeFault.autoStartsUsed !== 1
            )
              throw new Error('MISSING_PROTECTED_UNCERTAINTY')
            if (fault === 'body')
              await redis.del(`${queue.toKey(identity.jobId)}:am-request:${identity.incarnation}`)
            if (fault === 'scope') scope = 'b'.repeat(64)
            if (fault === 'evidence') await prisma.backgroundEffectEvidence.deleteMany()
            worker.resume()
          })().catch(reject)
        })
      })
      void worker.run().catch(() => undefined)
      expect((await terminal).message).toBe(reason)
      expect(calls).toBe(1)
      expect(renders).toBe(1)
      expect(await redis.hget(queue.toKey(identity.jobId), 'amEvidenceInitialized')).toBe('1')
      const retainedUncertainty = expect.objectContaining({
        certainty: 'unknown',
        unresolvedCount: 1,
        autoStartsUsed: 1,
      })
      expect(await evidence.read(definition.id, identity.incarnation)).toEqual(
        fault === 'evidence' ? null : retainedUncertainty
      )
    }
  )

  it('retries an acknowledged-unknown effect with the same frozen body/key and accepts exactly once', async () => {
    const accepted = new Map<string, string>()
    const requests: Array<{ key: string; body: string }> = []
    let renders = 0
    const email: EmailProvider = {
      send: async () => {
        throw new Error('DIRECT_SEND_FORBIDDEN')
      },
      sendPrepared: async () => {
        throw new Error('DIRECT_SEND_FORBIDDEN')
      },
      queuedEmail: {
        provider: 'mock',
        recipeVersion: 1,
        scope: () => 'a'.repeat(64),
        send: async (body, key, _signal, beforeTransport) => {
          beforeTransport()
          requests.push({ key, body })
          if (!accepted.has(key)) {
            accepted.set(key, body)
            return { certainty: 'unknown', retryable: true, code: 'TRANSIENT_FAILURE' }
          }
          if (accepted.get(key) !== body) throw new Error('BODY_CHANGED')
          return { certainty: 'accepted', retryable: false, code: 'COMPLETED' }
        },
      },
    }
    const observeEmailOperation = jest.fn()
    const policy = new QueuedEmailExecution(email, evidence, control, buffer, readiness, {
      observeEmailOperation,
    } as unknown as MetricsService)
    policy.onModuleInit()
    const execution = new WorkExecutionService(readiness, policy)
    const handler: WorkHandler = {
      prepareRequest: async () => {
        renders += 1
        return JSON.stringify({ render: renders })
      },
      run: async (_payload, context) => {
        await context.effect!.send()
      },
    }
    for (let index = 0; index < 2; index += 1) {
      const worker = new Worker(
        'email-fixture',
        async (job, token) => execution.run(definition, queue, job, token!, handler),
        {
          prefix: 'amcore',
          connection: buildBullConnection(broker.getConnectionUrl()),
          autorun: false,
        }
      )
      worker.on('error', () => undefined)
      workers.push(worker)
    }
    const completed = Promise.race(workers.map((worker) => once(worker, 'completed')))
    const producer = new ManagedProducer(definition, queue, readiness)
    const identity = await producer.add(
      'send',
      { reference: 'welcome' },
      { jobId: 'email-job', attempts: 2 }
    )
    await Promise.all(workers.map((worker) => worker.waitUntilReady()))
    for (const worker of workers) void worker.run().catch(() => undefined)
    await completed
    expect(renders).toBe(1)
    expect(accepted.size).toBe(1)
    expect(requests).toEqual(
      Array.from({ length: 2 }, () => ({
        key: `email:${identity.incarnation}`,
        body: '{"render":1}',
      }))
    )
    expect(await evidence.read(definition.id, identity.incarnation)).toMatchObject({
      certainty: 'accepted',
      outcomeRecorded: true,
      unresolvedCount: 0,
      autoStartsUsed: 2,
    })
    const budget = await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })
    expect(budget.unresolvedRows).toBe(0)
    expect(observeEmailOperation.mock.calls.map(([labels]) => labels)).toEqual([
      expect.objectContaining({ operation: 'process', result: 'error', retryable: 'true' }),
      expect.objectContaining({ operation: 'process', result: 'success', retryable: 'unknown' }),
    ])
  })
})
