import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import { AiMessageRole, AiRunStatus, Prisma } from '@/generated/prisma/client'

/**
 * Arc C merge gate (Track C — ADR-054, ADR-052 pattern). The durable AI-run worker proofs the unit
 * specs cannot give because they mock Prisma: the raw `FOR UPDATE SKIP LOCKED` claim, the lease/CAS
 * finalize, and the reaper against real Postgres, plus the full producer → claim → mock provider →
 * COMPLETED path with a durable transcript + usage-ledger row. The background recovery `@Cron` is
 * stopped and the BullMQ processor worker is closed in `beforeAll`, so each test deterministically
 * drives the dispatcher/repository itself with no automatic drain racing the DB-level assertions.
 *
 * Catalog: `cleanDatabase()` deletes the AI catalog rows AND flushes Redis (dropping the cached
 * snapshot), so each test reseeds with the convergent `seedAiCatalog()` — the locked Arc C decision.
 * With no provider key in e2e, the credential-gated default resolves to the key-less `mock` model,
 * so a run's frozen `modelSnapshot.modelSlug` is `mock-default` and the executor gets a deterministic
 * `[mock:mock] <input>` completion.
 */
describe('AI run durable worker (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let repository: AiRunRepository

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    repository = app.get(AiRunRepository, { strict: false })
    // Stop every scheduled cron (recovery/retention/cleanup) so nothing drains in the background.
    const scheduler = app.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
    // Close the AI wake consumer so a producer-enqueued wake never auto-drains a run under test.
    await app.get(AiRunDispatchProcessor, { strict: false }).worker.close()
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await seedAiCatalog(prisma)
  })

  let seq = 0
  async function createUser(): Promise<string> {
    seq += 1
    const email = `ai-run-${Date.now()}-${seq}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
      select: { id: true },
    })
    return user.id
  }

  async function createConversation(userId: string): Promise<string> {
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId },
      select: { id: true },
    })
    return conv.id
  }

  /** Queue a run through the real producer (frozen mock snapshot + USER turn bound by runId). */
  async function queueRun(
    text = 'hello'
  ): Promise<{ userId: string; conversationId: string; runId: string }> {
    const userId = await createUser()
    const conversationId = await createConversation(userId)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text }],
    })
    return { userId, conversationId, runId: run.id }
  }

  /** Insert a QUEUED run directly (no wake, no producer) — for repository-level claim/CAS/reaper. */
  async function createQueuedRunDirect(
    opts: { maxAttempts?: number; deadlineAt?: Date } = {}
  ): Promise<string> {
    const userId = await createUser()
    const conversationId = await createConversation(userId)
    const run = await prisma.aiRun.create({
      data: {
        conversationId,
        status: AiRunStatus.QUEUED,
        modelSnapshot: {
          modelSlug: 'mock-default',
          providerType: 'MOCK',
          providerModelName: 'mock',
          capabilities: { text: true },
          contextLimit: null,
          maxOutputTokens: null,
        } satisfies Prisma.InputJsonValue,
        maxAttempts: opts.maxAttempts ?? 3,
        ...(opts.deadlineAt ? { deadlineAt: opts.deadlineAt } : {}),
      },
      select: { id: true },
    })
    await prisma.aiMessage.create({
      data: {
        conversationId,
        runId: run.id,
        sequence: 0,
        role: AiMessageRole.USER,
        authorType: 'USER',
        authorUserId: userId,
        content: [{ type: 'text', text: 'hello' }] as unknown as Prisma.InputJsonValue,
      },
    })
    return run.id
  }

  describe('execution + durable finalization', () => {
    it('runs a queued run to COMPLETED with an assistant turn, bounded steps, and a usage-ledger row', async () => {
      const { userId, conversationId, runId } = await queueRun('hello')

      await dispatch.drainDueBatches()

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.COMPLETED)
      expect(run.finishedAt).toBeInstanceOf(Date)
      expect(run.errorCode).toBeNull()
      expect(run.terminalReasonCode).toBeNull()
      // The frozen snapshot resolved to the key-less mock default (no key in e2e).
      expect((run.modelSnapshot as { modelSlug: string }).modelSlug).toBe('mock-default')

      const assistant = await prisma.aiMessage.findFirstOrThrow({
        where: { runId, role: AiMessageRole.ASSISTANT },
      })
      // Arc D: the worker sends the user turn through the structural trust boundary, and the mock
      // answers the INNER user text (not the wrapper), so the assistant turn is the clean echo and
      // carries no boundary marker (which would otherwise trip the output guard).
      const assistantPart = (assistant.content as { type: string; text: string }[])[0]!
      expect(assistantPart).toEqual({ type: 'text', text: '[mock:mock] hello' })

      const steps = await prisma.aiRunStep.findMany({
        where: { runId },
        orderBy: { stepNumber: 'asc' },
      })
      expect(steps.map((s) => s.type)).toEqual(['PROVIDER_CALL', 'FINALIZATION'])

      const ledgers = await prisma.aiUsageLedger.findMany({ where: { runId } })
      expect(ledgers).toHaveLength(1)
      expect(ledgers[0]).toMatchObject({
        modelSlug: 'mock-default',
        conversationId,
        userId,
      })
      expect(ledgers[0]!.inputTokens).toBeGreaterThan(0)
      expect(ledgers[0]!.outputTokens).toBeGreaterThan(0)
    })

    it('drains a committed run whose wake was never enqueued (recovery poller path)', async () => {
      const runId = await createQueuedRunDirect()

      await dispatch.runDispatchCycle()

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.COMPLETED)
      const assistant = await prisma.aiMessage.count({
        where: { runId, role: AiMessageRole.ASSISTANT },
      })
      expect(assistant).toBe(1)
    })

    it('is exactly-once: one assistant turn + one ledger row even if drained twice', async () => {
      const { runId } = await queueRun('hello')

      await dispatch.drainDueBatches()
      await dispatch.drainDueBatches() // second drain finds the run already terminal → no-op

      expect(
        await prisma.aiMessage.count({ where: { runId, role: AiMessageRole.ASSISTANT } })
      ).toBe(1)
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(1)
    })
  })

  describe('cancellation + deadline (no provider effect)', () => {
    it('honors a cooperative cancel observed before the provider call', async () => {
      const { runId } = await queueRun('hello')
      await prisma.aiRun.update({
        where: { id: runId },
        data: { cancellationRequestedAt: new Date() },
      })

      await dispatch.drainDueBatches()

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.CANCELLED)
      expect(run.terminalReasonCode).toBe('cancelled_by_user')
      expect(
        await prisma.aiMessage.count({ where: { runId, role: AiMessageRole.ASSISTANT } })
      ).toBe(0)
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(0)
    })

    it('sweeps a queued run past its deadline to EXPIRED without calling the provider', async () => {
      const runId = await createQueuedRunDirect({ deadlineAt: new Date(Date.now() - 60_000) })

      await dispatch.runDispatchCycle()

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.EXPIRED)
      expect(run.terminalReasonCode).toBe('deadline_exceeded')
      expect(
        await prisma.aiMessage.count({ where: { runId, role: AiMessageRole.ASSISTANT } })
      ).toBe(0)
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(0)
    })
  })

  describe('provider error handling', () => {
    it('schedules a retry (run back to QUEUED) on a retryable provider failure', async () => {
      const { runId } = await queueRun('__mock_error__') // → provider_unavailable (retryable)

      await dispatch.drainDueBatches()

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.QUEUED)
      expect(run.attemptCount).toBe(1)
      expect(run.errorCode).toBe('provider_unavailable')
      expect(run.nextAttemptAt).toBeInstanceOf(Date)
      expect(run.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
      expect(
        await prisma.aiMessage.count({ where: { runId, role: AiMessageRole.ASSISTANT } })
      ).toBe(0)
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(0)
    })

    it('terminally fails a permanent provider refusal', async () => {
      const { runId } = await queueRun('__mock_refusal__') // → content_filtered (permanent)

      await dispatch.drainDueBatches()

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.FAILED)
      expect(run.errorCode).toBe('content_filtered')
      expect(run.terminalReasonCode).toBe('permanent_failure')
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(0)
    })
  })

  describe('concurrency: SKIP LOCKED claim + CAS finalize + reaper (real Postgres)', () => {
    it('claims due runs under FOR UPDATE SKIP LOCKED without double-claiming', async () => {
      const ids = await Promise.all(Array.from({ length: 6 }, () => createQueuedRunDirect()))

      const [a, b] = await Promise.all([repository.claimDueBatch(3), repository.claimDueBatch(3)])
      const claimedA = a.map((c) => c.id)
      const claimedB = b.map((c) => c.id)

      expect(claimedA.filter((id) => claimedB.includes(id))).toEqual([])
      expect(new Set([...claimedA, ...claimedB])).toEqual(new Set(ids))

      const running = await prisma.aiRun.findMany({
        where: { id: { in: ids }, status: AiRunStatus.RUNNING },
      })
      expect(running).toHaveLength(6)
      expect(running.every((r) => r.attemptCount === 1 && r.leaseToken !== null)).toBe(true)
    })

    it('uses a single lease token per claim batch', async () => {
      await Promise.all([createQueuedRunDirect(), createQueuedRunDirect()])
      const claimed = await repository.claimDueBatch(10)
      expect(claimed).toHaveLength(2)
      expect(new Set(claimed.map((c) => c.leaseToken)).size).toBe(1)
      expect(claimed[0]!.leaseToken).toBeTruthy()
    })

    it('rejects a stale lease holder via CAS after the lease is reaped', async () => {
      const runId = await createQueuedRunDirect()
      const [claim] = await repository.claimDueBatch(1)
      expect(claim!.id).toBe(runId)

      // Force the lease to look expired, then reap → re-queued (attempts remain).
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
      })
      const reaped = await repository.reapExpiredLeases()
      expect(reaped).toEqual({ rescheduled: 1, failed: 0 })

      const afterReap = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(afterReap.status).toBe(AiRunStatus.QUEUED)
      expect(afterReap.leaseToken).toBeNull()

      // The stale holder now tries to commit success — its CAS must match 0 rows.
      const won = await repository.finalizeCompleted(prisma, claim!)
      expect(won).toBe(false)

      const afterStale = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(afterStale.status).toBe(AiRunStatus.QUEUED)
      expect(
        await prisma.aiMessage.count({ where: { runId, role: AiMessageRole.ASSISTANT } })
      ).toBe(0)
    })

    it('reaps an expired lease to FAILED once the retry budget is exhausted', async () => {
      const runId = await createQueuedRunDirect({ maxAttempts: 1 })
      await repository.claimDueBatch(1) // attemptCount → 1 (== maxAttempts)
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
      })

      const reaped = await repository.reapExpiredLeases()
      expect(reaped).toEqual({ rescheduled: 0, failed: 1 })

      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
      expect(run.status).toBe(AiRunStatus.FAILED)
      expect(run.errorCode).toBe('lease_expired')
      expect(run.terminalReasonCode).toBe('attempts_exhausted')
    })
  })
})
