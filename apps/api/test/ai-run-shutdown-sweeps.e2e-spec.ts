import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AiRunExecutorService } from '../src/infrastructure/ai/runs/ai-run-executor.service'
import type { PrismaService } from '../src/prisma'

import { ControllableAdapter, controls, deferred } from './fixtures/ai-run-controls'
import { closeManagedWorker } from './fixtures/background-work/close-managed-worker'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import { AiRunStatus } from '@/generated/prisma/client'

/**
 * After the shutdown SEAL nothing of the worker may start a database operation (Track C — ADR-054). An
 * outer wrapper around a multi-step callback releases its waiter at the seal but lets the callback keep
 * going, so this proves each ACTUAL asynchronous operation is fenced, against real Postgres:
 *
 * - a reaper pass delayed inside its first transaction starts neither of the two later sweeps once the
 *   dispatcher has sealed, and its tail inside the open transaction rolls back;
 * - an executor pre-flight whose first read is delayed starts no later read, no artifact fetch and no run
 *   loop after the seal.
 */
describe('AI run dispatcher: no database operation starts after the seal (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let repository: AiRunRepository
  let executor: AiRunExecutorService

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder.overrideProvider(AI_PROVIDER_ADAPTERS).useValue([new ControllableAdapter()])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    repository = app.get(AiRunRepository, { strict: false })
    executor = app.get(AiRunExecutorService, { strict: false })
    for (const job of app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      job.stop()
    await closeManagedWorker(app, 'ai-runs')
  }, 180000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    controls.reset()
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await seedAiCatalog(prisma)
    await context.app.get(AiModelRegistry, { strict: false }).invalidate()
  })

  it('a delayed reaper and a delayed pre-flight start NOTHING further once sealed', async () => {
    const email = `seal-${Date.now()}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
    })
    const conversation = await prisma.aiConversation.create({ data: { ownerUserId: user.id } })
    const queued = await producer.create(user.id, {
      conversationId: conversation.id,
      inputParts: [{ type: 'text', text: 'hello' }],
    })
    const [claim] = await repository.claimDueBatch(1) // an attempt for the executor pre-flight below
    expect(claim?.id).toBe(queued.id)

    const reaperEntered = deferred()
    const releaseReaper = deferred()
    const original = prisma.$transaction.bind(prisma)
    let transactionsStarted = 0
    const patched = prisma.$transaction
    ;(prisma as { $transaction: unknown }).$transaction = ((callback: never, options: never) => {
      transactionsStarted += 1
      const ordinal = transactionsStarted
      return (original as (cb: unknown, opts: unknown) => Promise<unknown>)(async (tx: unknown) => {
        if (ordinal === 1) {
          reaperEntered.resolve()
          await releaseReaper.promise
        }
        return (callback as (t: unknown) => Promise<unknown>)(tx)
      }, options)
    }) as typeof prisma.$transaction

    // The executor's first pre-flight read, delayed through the model delegate.
    const readEntered = deferred()
    const releaseRead = deferred()
    let readsAfterFirst = 0
    const conversationDelegate = prisma.aiConversation
    const realFindUnique = conversationDelegate.findUnique.bind(conversationDelegate)
    const messageDelegate = prisma.aiMessage
    const realFindFirst = messageDelegate.findFirst.bind(messageDelegate)
    ;(conversationDelegate as { findUnique: unknown }).findUnique = (async (...args: unknown[]) => {
      readEntered.resolve()
      await releaseRead.promise
      return (realFindUnique as (...a: unknown[]) => unknown)(...args)
    }) as never
    ;(messageDelegate as { findFirst: unknown }).findFirst = ((...args: unknown[]) => {
      readsAfterFirst += 1
      return (realFindFirst as (...a: unknown[]) => unknown)(...args)
    }) as never

    try {
      const reap = dispatch.reap()
      const preflight = executor.execute(claim!, {
        attempt: {
          signal: new AbortController().signal,
          abort: () => undefined,
          dispose: () => undefined,
        },
        onTransportStarted: () => undefined,
      } as never)
      await Promise.all([reaperEntered.promise, readEntered.promise])

      // The pre-flight's own admission transaction legitimately ran before the seal; count from here.
      const startedBeforeSeal = transactionsStarted
      await dispatch.shutdown() // closes, then seals (grace is short: nothing completes on its own)
      releaseReaper.resolve()
      releaseRead.resolve()
      await Promise.all([reap, preflight])
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(transactionsStarted).toBe(startedBeforeSeal) // the two later sweeps never opened a transaction
      expect(readsAfterFirst).toBe(0) // no later pre-flight read started
      expect(controls.providerCalls).toBe(0) // the loop was never entered
      expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe(
        AiRunStatus.RUNNING
      ) // nothing wrote anything: recovery is by lease expiry
    } finally {
      releaseReaper.resolve()
      releaseRead.resolve()
      ;(prisma as { $transaction: unknown }).$transaction = patched
      ;(conversationDelegate as { findUnique: unknown }).findUnique = realFindUnique
      ;(messageDelegate as { findFirst: unknown }).findFirst = realFindFirst
    }
  })
})
