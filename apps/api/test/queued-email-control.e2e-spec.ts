import { once } from 'node:events'

import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { PinoLogger } from 'nestjs-pino'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { EnvService } from '../src/env/env.service'
import { PrismaClient } from '../src/generated/prisma/client'
import { ControlConnection } from '../src/infrastructure/background-work/control-connection'
import { backgroundControlTransaction } from '../src/infrastructure/background-work/control-transaction'
import { managedProcessor } from '../src/infrastructure/background-work/managed-processor'
import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import { PgOutcomeBuffer } from '../src/infrastructure/background-work/pg-outcome-buffer'
import { ProviderEvidenceStore } from '../src/infrastructure/background-work/provider-evidence.store'
import { initializeManagedQueue } from '../src/infrastructure/background-work/scripts/initialize-queue'
import { proveStaleProviderOwner } from '../src/infrastructure/background-work/scripts/stale-provider-owner'
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
import { upgradeWelcomeJob } from '../src/infrastructure/email/upgrade-welcome-job'
import { welcomeUpgradeInventory } from '../src/infrastructure/email/welcome-upgrade-inventory'
import type { MetricsService } from '../src/infrastructure/observability'
import { DEFAULT_JOB_OPTIONS } from '../src/infrastructure/queue/interfaces/job-options.interface'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'
import { migrateTestDatabase } from './helpers'

const definition = defineOrdinaryWork({
  id: 'email-fixture',
  definitionVersion: 1,
  queue: { name: 'email-fixture', enabled: true },
  jobs: {
    send: {
      wireVersion: 1,
      schema: z.strictObject({ reference: z.string() }),
      replay: { kind: 'conservative', policyVersion: 2, recipe: 'queued-email' },
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
    postgres = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
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

  it('quarantines raw legacy WELCOME even on its first current claim without implicit v2 admission', async () => {
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
        recipeVersion: 2,
        transportTimeoutMs: 30000,
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
        ['legacy-fresh', 'EFFECT_UNKNOWN'],
        ['legacy-started', 'EFFECT_UNKNOWN'],
        ['legacy-malformed', 'PERMANENT_FAILURE'],
        ['legacy-unsupported', 'CONTENT_UNSUPPORTED'],
      ])
    )
    expect(renders).toBe(0)
    const fresh = (await queue.getJob('legacy-fresh'))!
    expect(requests).toEqual([])
    expect(await evidence.read('email', fresh.data.incarnation)).toMatchObject({
      certainty: 'unknown',
      autoStartsUsed: 0,
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
        recipeVersion: 2,
        transportTimeoutMs: 30000,
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
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(2000)
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
          recipeVersion: 2,
          transportTimeoutMs: 30000,
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
      expect(error.message).toBe(
        certainty === 'unknown'
          ? 'EFFECT_UNKNOWN'
          : permanent
            ? 'PERMANENT_FAILURE'
            : 'TRANSIENT_FAILURE'
      )
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
          recipeVersion: 2,
          transportTimeoutMs: 30000,
          scope: () => scope,
          send: async (_body, _key, _signal, beforeTransport) => {
            beforeTransport()
            calls += 1
            return { certainty: 'none', retryable: true, code: 'TRANSIENT_FAILURE' }
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
              beforeFault?.certainty !== 'none' ||
              beforeFault.unresolvedCount !== 0 ||
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
        certainty: 'none',
        unresolvedCount: 0,
        autoStartsUsed: 1,
      })
      expect(await evidence.read(definition.id, identity.incarnation)).toEqual(
        fault === 'evidence' ? null : retainedUncertainty
      )
    }
  )

  it('stops after an unknown outcome despite remaining native retries and provider dedup', async () => {
    let calls = 0
    const provider: EmailProvider = {
      send: async () => {
        throw new Error('FORBIDDEN')
      },
      sendPrepared: async () => {
        throw new Error('FORBIDDEN')
      },
      queuedEmail: {
        provider: 'mock',
        recipeVersion: 2,
        transportTimeoutMs: 30000,
        scope: () => 'a'.repeat(64),
        send: async (_body, _key, _signal, admit) => {
          admit()
          calls += 1
          return {
            certainty: 'unknown',
            retryable: true,
            code: 'RATE_LIMITED',
            retryAfter: { kind: 'unsupported' },
          }
        },
      },
    }
    const policy = new QueuedEmailExecution(provider, evidence, control, buffer, readiness)
    policy.onModuleInit()
    const execution = new WorkExecutionService(readiness, policy)
    const identity = await new ManagedProducer(definition, queue, readiness).add(
      'send',
      { reference: 'unknown' },
      { attempts: 3 }
    )
    const worker = new Worker(
      queue.name,
      (job, token) =>
        execution.run(definition, queue, job, token!, {
          prepareRequest: async () => '{}',
          run: async (_payload, ctx) => ctx.effect!.send(),
        }),
      {
        prefix: 'amcore',
        connection: buildBullConnection(broker.getConnectionUrl()),
        autorun: false,
      }
    )
    workers.push(worker)
    const failed = once(worker, 'failed')
    void worker.run().catch(() => undefined)
    const [job, error] = await failed
    expect(error.message).toBe('EFFECT_UNKNOWN')
    expect(await job.getState()).toBe('failed')
    expect(calls).toBe(1)
    const row = await evidence.read(definition.id, identity.incarnation)
    expect(row).toMatchObject({
      certainty: 'unknown',
      unresolvedCount: 1,
      autoStartsUsed: 1,
      cooldownSupported: false,
      recipeVersion: 2,
      nominalDeadline: null,
    })
    expect(evidence.controlReason(row, 'retry', Date.now())).toBe('EFFECT_UNKNOWN')
    // Adversarial stock requeue cannot bypass PG authority, even when native attempts reset.
    await worker.pause(true)
    const refusedAgain = once(worker, 'failed')
    await job.retry()
    worker.resume()
    const [, secondError] = await refusedAgain
    expect(secondError.message).toBe('EFFECT_UNKNOWN')
    expect(calls).toBe(1)
    expect((await evidence.read(definition.id, identity.incarnation))!.autoStartsUsed).toBe(1)
    expect(
      (await prisma.backgroundBudget.findUniqueOrThrow({ where: { key: 'global' } })).unresolvedRows
    ).toBe(1)
    policy.onModuleDestroy()
  })

  async function reservedFixture() {
    const identity = await new ManagedProducer(definition, queue, readiness).add('send', {
      reference: 'evidence',
    })
    const input = {
      workId: definition.id,
      jobId: identity.jobId,
      incarnation: identity.incarnation,
      queueEpoch: (await redis.hget(queue.toKey('meta'), 'amQueueEpoch'))!,
      jobName: 'send',
      wireVersion: 1,
      policyVersion: 2,
      automaticLimit: 3,
      requestDigest: 'a'.repeat(64),
      providerScope: 'b'.repeat(64),
      cooldownRevision: 0,
    }
    const result = await evidence.reserve(input)
    if ('accepted' in result) throw new Error('UNEXPECTED_ACCEPTANCE')
    return {
      input,
      attempt: result,
      witness: {
        incarnation: identity.incarnation,
        attemptId: result.attemptId,
        kind: 'reported' as const,
        brokerRevision: 1,
      },
    }
  }

  it('retains aggregate unknown across unsupported delay, acknowledgment, compaction and late acceptance', async () => {
    const { input, attempt, witness } = await reservedFixture()
    await evidence.finalize(
      attempt,
      { certainty: 'unknown', code: 'RATE_LIMITED', retryAfter: { kind: 'unsupported' } },
      witness
    )
    let row = (await evidence.read(input.workId, input.incarnation))!
    expect(evidence.controlReason(row, 'retry', Date.now())).toBe('EFFECT_UNKNOWN')
    await expect(
      evidence.reserve({ ...input, cooldownRevision: row.cooldownRevision })
    ).rejects.toThrow('EFFECT_UNKNOWN')
    await backgroundControlTransaction(prisma as PrismaService, async (ctx) => {
      await evidence.acknowledge(ctx, input.workId, input.jobId, {
        incarnation: input.incarnation,
        revision: row.revision,
        disposition: 'acknowledged_unknown',
        reason: 'Reviewed ambiguous attempt',
        references: ['incident-fixture'],
      })
    })
    await prisma.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId: input.workId, incarnation: input.incarnation } },
      data: { createdAt: new Date(Date.now() - 31 * 86400000) },
    })
    await backgroundControlTransaction(prisma as PrismaService, async (ctx) => {
      expect(await evidence.purge(ctx, input.workId, input.incarnation)).toBe(false)
      expect(await evidence.compactUnknown(ctx, input.workId, input.incarnation)).toBe(true)
    })
    row = (await evidence.read(input.workId, input.incarnation))!
    expect(row).toMatchObject({
      certainty: 'unknown',
      disposition: 'acknowledged_unknown',
      unresolvedCount: 1,
      logicalBytes: 512,
      autoStartsUsed: 1,
      recipeVersion: 2,
    })
    await evidence.finalize(attempt, { certainty: 'accepted', code: 'COMPLETED' }, witness)
    row = (await evidence.read(input.workId, input.incarnation))!
    expect(row.certainty).toBe('accepted')
    expect(row.unresolvedCount).toBe(0)
    await evidence.finalize(attempt, { certainty: 'none', code: 'TRANSIENT_FAILURE' }, witness)
    expect((await evidence.read(input.workId, input.incarnation))!.certainty).toBe('accepted')
  })

  it('does not grant v2 privileges to retained v1 or relabelled evidence', async () => {
    const { input } = await reservedFixture()
    await prisma.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId: input.workId, incarnation: input.incarnation } },
      data: {
        policyVersion: 1,
        recipeVersion: null,
        activeAttemptId: null,
        outcomeRecorded: true,
        certainty: 'none',
        unresolvedCount: 0,
      },
    })
    await expect(evidence.reserve(input)).rejects.toThrow('VERSION_UNSUPPORTED')
    const row = (await evidence.read(input.workId, input.incarnation))!
    expect(evidence.controlReason(row, 'retry', Date.now())).toBe('VERSION_UNSUPPORTED')
    await prisma.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId: input.workId, incarnation: input.incarnation } },
      data: { policyVersion: 2 },
    })
    await expect(evidence.reserve(input)).rejects.toThrow('VERSION_UNSUPPORTED')
  })

  it('requires revoked ownership proof before recovering or acknowledging an unrecorded v2 attempt', async () => {
    const { input, attempt } = await reservedFixture()
    expect(evidence.dispositionReason(attempt.row, Date.now() + 2 * 86400000)).toBe(
      'OUTCOME_UNRECORDED'
    )
    await expect(
      evidence.recoverStale(
        input.workId,
        input.incarnation,
        attempt.row.revision,
        async () => false
      )
    ).rejects.toThrow('OUTCOME_UNRECORDED')
    expect((await evidence.read(input.workId, input.incarnation))!.activeAttemptId).toBe(
      attempt.attemptId
    )
  })

  it('converts only untouched v1 work offline, resumes idempotently and preserves old effects', async () => {
    const old = {
      ...emailWork,
      queue: { ...emailWork.queue!, name: queue.name },
      jobs: {
        'send-email': {
          ...emailWork.jobs['send-email'],
          replay: {
            kind: 'provider-window' as const,
            policyVersion: 1,
            recipe: 'queued-email' as const,
          },
        },
      },
    }
    const payload = {
      template: EmailTemplate.WELCOME as const,
      to: 'fake@example.invalid',
      data: { name: 'Fixture', email: 'fake@example.invalid' },
    }
    const fresh = await new ManagedProducer(old, queue, readiness).add('send-email', payload)
    const started = await new ManagedProducer(old, queue, readiness).add('send-email', payload)
    expect(await upgradeWelcomeJob(redis, prisma, queue, fresh.jobId, true)).toMatchObject({
      status: 'blocked',
      reason: 'ACTIVE_JOB',
    })
    await queue.pause()
    await redis.hset(queue.toKey(started.jobId), 'ats', '1')
    const prior = await redis.hget(queue.toKey(fresh.jobId), 'data')
    expect(await upgradeWelcomeJob(redis, prisma, queue, fresh.jobId, false)).toEqual({
      status: 'eligible',
    })
    expect(await redis.hget(queue.toKey(fresh.jobId), 'data')).toBe(prior)
    expect(await upgradeWelcomeJob(redis, prisma, queue, fresh.jobId, true)).toMatchObject({
      status: 'converted',
      incarnation: fresh.incarnation,
      fromPolicy: 1,
      toPolicy: 2,
    })
    expect(await upgradeWelcomeJob(redis, prisma, queue, fresh.jobId, true)).toEqual({
      status: 'already_v2',
    })
    expect(await prisma.backgroundEffectEvidence.count()).toBe(0)
    const data = JSON.parse((await redis.hget(queue.toKey(fresh.jobId), 'data'))!)
    expect(data).toMatchObject({
      incarnation: fresh.incarnation,
      executionPolicyVersion: 2,
      payload,
    })
    expect(await upgradeWelcomeJob(redis, prisma, queue, started.jobId, true)).toMatchObject({
      status: 'blocked',
      reason: 'OUTCOME_UNRECORDED',
    })
    expect(
      JSON.parse((await redis.hget(queue.toKey(started.jobId), 'data'))!).executionPolicyVersion
    ).toBe(1)
  })

  it('recovers a stale v2 owner only after fencing proof and keeps late acceptance on the original attempt', async () => {
    const { input, attempt, witness } = await reservedFixture()
    const key = queue.toKey(input.jobId)
    const token = 'replacement-owner'
    await redis.set(`${key}:lock`, token, 'PX', 30000)
    await redis.hset(
      key,
      'amIncarnation',
      input.incarnation,
      'amEffectAttempt',
      attempt.attemptId,
      'amMetadata',
      JSON.stringify({ invocationId: attempt.attemptId, report: 'unrecorded' })
    )
    const proof = () =>
      control.withClient((client) =>
        proveStaleProviderOwner(client, key, token, input.incarnation, attempt.attemptId)
      )
    expect(await proof()).toBe(true)
    await evidence.recoverStale(input.workId, input.incarnation, attempt.row.revision, proof)
    const row = (await evidence.read(input.workId, input.incarnation))!
    expect(row).toMatchObject({
      certainty: 'unknown',
      activeAttemptId: null,
      outcomeRecorded: true,
      autoStartsUsed: 1,
      unresolvedCount: 1,
    })
    expect(evidence.dispositionReason(row, Date.now())).toBeUndefined()
    await expect(evidence.refence(attempt)).rejects.toThrow('OUTCOME_UNRECORDED')
    await evidence.finalize(attempt, { certainty: 'accepted', code: 'COMPLETED' }, witness)
    expect((await evidence.read(input.workId, input.incarnation))!.certainty).toBe('accepted')
  })

  it('inventories trimmed PG uncertainty without loading message bodies', async () => {
    const { input, attempt, witness } = await reservedFixture()
    await evidence.finalize(attempt, { certainty: 'unknown', code: 'TRANSIENT_FAILURE' }, witness)
    await redis.del(queue.toKey(input.jobId))
    const inventory = await welcomeUpgradeInventory(redis, prisma, queue, '0')
    // This fixture's work ID is deliberately separate from the production EMAIL inventory.
    expect(inventory.evidence).toEqual([])
    await prisma.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId: input.workId, incarnation: input.incarnation } },
      data: { workId: 'email' },
    })
    const retained = await welcomeUpgradeInventory(redis, prisma, queue, '0')
    expect(retained.evidence).toEqual([
      expect.objectContaining({
        incarnation: input.incarnation,
        jobId: input.jobId,
        certainty: 'unknown',
        recipeVersion: 2,
      }),
    ])
    expect(retained.nextEvidenceCursor).toBeNull()
    expect(JSON.stringify(retained)).not.toContain('requestDigest')
  })
})
