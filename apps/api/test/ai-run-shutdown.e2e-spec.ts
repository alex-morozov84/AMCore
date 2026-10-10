import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import type { PrismaService } from '../src/prisma'

import { ControllableAdapter, controls, deferred, until } from './fixtures/ai-run-controls'
import { closeManagedWorker } from './fixtures/background-work/close-managed-worker'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import { AiRunStatus } from '@/generated/prisma/client'
import { ShutdownLatch } from '@/infrastructure/worker-lifecycle'

/**
 * Worker shutdown against real Postgres (Track C — ADR-054): after the dispatcher is closed nothing new
 * starts, the wait for in-flight work is bounded even if a provider call never settles, and once the
 * cutoff is sealed a late provider result writes NOTHING — the interrupted run stays leased and is
 * recovered through lease expiry by the next worker.
 */
describe('AI run dispatcher shutdown (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let repository: AiRunRepository

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder.overrideProvider(AI_PROVIDER_ADAPTERS).useValue([new ControllableAdapter()])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    repository = app.get(AiRunRepository, { strict: false })
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

  async function queue(text: string): Promise<string> {
    const email = `ai-shutdown-${Date.now()}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
      select: { id: true },
    })
    const conversation = await prisma.aiConversation.create({
      data: { ownerUserId: user.id },
      select: { id: true },
    })
    const run = await producer.create(user.id, {
      conversationId: conversation.id,
      inputParts: [{ type: 'text', text }],
    })
    return run.id
  }

  it('is bounded by the grace even when a provider call never settles; a late result then writes NOTHING', async () => {
    const runId = await queue('hello')
    const never = deferred()
    controls.providerHook = () => never.promise // the provider call hangs
    dispatch.shutdownGraceMs = 300

    const drain = dispatch.drainDueBatches()
    await until(() => controls.providerInFlight === 1)

    const startedAt = Date.now()
    await dispatch.shutdown() // must NOT wait for the hung call
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    await drain

    // Nothing new starts once closed, and a repeated shutdown shares the same (already fixed) deadline.
    await dispatch.drainDueBatches()
    await dispatch.runDispatchCycle()
    expect(controls.providerCalls).toBe(1)
    await dispatch.shutdown()

    // The hung provider call finally returns AFTER the seal: it must not write a step, a ledger row, a turn
    // or a terminal state — the run stays leased for lease-expiry recovery.
    never.resolve()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    expect(run.status).toBe(AiRunStatus.RUNNING)
    expect(run.leaseToken).not.toBeNull()
    expect(await prisma.aiRunStep.count({ where: { runId } })).toBe(0)
    expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(0)
    expect(await prisma.aiMessage.count({ where: { runId, role: 'ASSISTANT' } })).toBe(0)

    // A later worker recovers it through lease expiry (the attempt had admitted I/O, so it consumes a retry).
    await prisma.aiRun.update({
      where: { id: runId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    // The sealed process itself no longer sweeps (nothing may start after the seal)…
    expect(await repository.reapExpiredLeases()).toEqual({ rescheduled: 0, failed: 0 })
    // …a LATER worker (a new process, so a fresh latch) reclaims the run.
    const nextWorker = new AiRunRepository(
      prisma,
      new ShutdownLatch({ warn: () => undefined }, 'ai.run')
    )
    expect(await nextWorker.reapExpiredLeases()).toEqual({ rescheduled: 1, failed: 0 })
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      AiRunStatus.QUEUED
    )
  })
})
