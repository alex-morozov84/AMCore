import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiApprovalService } from '../src/core/ai/approvals/ai-approval.service'
import { AiConversationControlService } from '../src/core/ai/conversations/ai-conversation-control.service'
import { AiRunService } from '../src/core/ai/runs/ai-run.service'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiApprovalExpiryService } from '../src/infrastructure/ai/runs/ai-approval-expiry.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AI_TOOLS } from '../src/infrastructure/ai/tools/ai-tool.types'
import type { PrismaService } from '../src/prisma'

import { ControllableAdapter, controls } from './fixtures/ai-run-controls'
import { demoSensitiveTool } from './fixtures/demo-sensitive.tool'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import {
  AiApprovalState,
  AiRunAttemptOutcome,
  AiRunStatus,
  AiToolInvocationStatus,
} from '@/generated/prisma/client'

/**
 * Attempt history, retry budget, idempotent replay and lock-order proofs over REAL Postgres (Track C —
 * ADR-054). The retry budget counts CONSUMED RETRIES (never claims); every lease epoch is recorded in a
 * bounded history that survives retries, reaping and approval resumes; a replayed request with a different
 * input conflicts; and the approve / cancel / expiry / takeover / reaper paths take their locks in one
 * global order, so concurrent schedules finish without a deadlock.
 */
describe('AI run history, replay and lock order (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let repository: AiRunRepository
  let runService: AiRunService
  let approvals: AiApprovalService
  let expiry: AiApprovalExpiryService
  let control: AiConversationControlService

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder
        .overrideProvider(AI_TOOLS)
        .useValue([demoSensitiveTool])
        .overrideProvider(AI_PROVIDER_ADAPTERS)
        .useValue([new ControllableAdapter()])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    repository = app.get(AiRunRepository, { strict: false })
    runService = app.get(AiRunService, { strict: false })
    approvals = app.get(AiApprovalService, { strict: false })
    expiry = app.get(AiApprovalExpiryService, { strict: false })
    control = app.get(AiConversationControlService, { strict: false })
    const scheduler = app.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
    await app.get(AiRunDispatchProcessor, { strict: false }).worker.close()
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

  let seq = 0
  async function createUser(): Promise<string> {
    seq += 1
    const email = `ai-hist-${Date.now()}-${seq}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
      select: { id: true },
    })
    return user.id
  }

  async function createConversation(userId: string, withTool = false): Promise<string> {
    seq += 1
    const assistant = withTool
      ? await prisma.aiAssistant.create({
          data: {
            slug: `hist-${Date.now()}-${seq}`,
            version: 1,
            displayName: 'History assistant',
            enabled: true,
            modelSelection: { modelSlug: 'mock-default' },
            allowedModalities: ['text'],
            toolAllowlist: ['demo_sensitive'],
          },
          select: { id: true },
        })
      : null
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId, ...(assistant ? { assistantId: assistant.id } : {}) },
      select: { id: true },
    })
    return conv.id
  }

  async function queue(text: string, withTool = false) {
    const userId = await createUser()
    const conversationId = await createConversation(userId, withTool)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text }],
    })
    return { userId, conversationId, runId: run.id }
  }

  const getRun = (runId: string) => prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
  const attempts = (runId: string) =>
    prisma.aiRunAttempt.findMany({ where: { runId }, orderBy: { epoch: 'asc' } })

  /** Make a retry-scheduled run due again now. */
  const fastForward = (runId: string) =>
    prisma.aiRun.update({ where: { id: runId }, data: { nextAttemptAt: new Date(Date.now() - 1) } })

  describe('attempt history and retry budget', () => {
    it('a fresh run still gets exactly three executions; each epoch is recorded with its own outcome', async () => {
      const { runId } = await queue('__mock_error__') // a retryable provider failure every time

      const observed: Array<[number, string, number]> = []
      for (let execution = 1; execution <= 3; execution += 1) {
        await dispatch.drainDueBatches()
        const run = await getRun(runId)
        observed.push([run.leaseEpoch, run.status, run.attemptCount])
        await fastForward(runId) // a no-op once the run is terminal
      }
      // One retry consumed per failed execution; the third failure exhausts the budget.
      expect(observed).toEqual([
        [1, AiRunStatus.QUEUED, 1],
        [2, AiRunStatus.QUEUED, 2],
        [3, AiRunStatus.FAILED, 2],
      ])

      const final = await getRun(runId)
      expect(final.status).toBe(AiRunStatus.FAILED)
      expect(final.terminalReasonCode).toBe('attempts_exhausted')
      expect(controls.providerCalls).toBe(3) // exactly three executions, never a fourth
      expect((await attempts(runId)).map((a) => [a.epoch, a.outcome])).toEqual([
        [1, AiRunAttemptOutcome.RETRY_SCHEDULED],
        [2, AiRunAttemptOutcome.RETRY_SCHEDULED],
        [3, AiRunAttemptOutcome.FAILED],
      ])
    })

    it('an approval resume is a NEW epoch that spends no retry budget and reuses no number', async () => {
      const { userId, runId } = await queue('__mock_tool__:demo_sensitive', true)
      await dispatch.drainDueBatches() // parks behind an approval
      const parked = await getRun(runId)
      expect(parked.status).toBe(AiRunStatus.WAITING_APPROVAL)
      expect(parked.attemptCount).toBe(0)
      const approval = await prisma.aiApproval.findFirstOrThrow({ where: { runId } })

      await approvals.decide(userId, approval.id, { decision: 'approve' })
      expect((await getRun(runId)).attemptCount).toBe(0) // a decision neither spends nor refunds budget
      await dispatch.drainDueBatches()

      const done = await getRun(runId)
      expect(done.status).toBe(AiRunStatus.COMPLETED)
      expect(done.attemptCount).toBe(0)
      expect(done.leaseEpoch).toBe(2)
      expect((await attempts(runId)).map((a) => [a.epoch, a.outcome])).toEqual([
        [1, AiRunAttemptOutcome.AWAITING_APPROVAL],
        [2, AiRunAttemptOutcome.SUCCEEDED],
      ])
    })

    it('reaping closes the dead attempt atomically; a pre-I/O reclaim consumes NO retry budget', async () => {
      const { runId } = await queue('hello')
      await repository.claimDueBatch(1) // epoch 1, no I/O admitted yet (ioStartedAt unset)
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      })

      expect(await repository.reapExpiredLeases()).toEqual({ rescheduled: 1, failed: 0 })

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.QUEUED)
      expect(run.attemptCount).toBe(0) // the attempt never started I/O: nothing consumed
      const [attempt] = await attempts(runId)
      expect(attempt!.outcome).toBe(AiRunAttemptOutcome.REAPED)
      expect(attempt!.endedAt).toBeInstanceOf(Date)
      expect(attempt!.ioStartedAt).toBeNull() // "possible start" never happened
    })

    it('an attempt that admitted I/O consumes one retry when reaped', async () => {
      const { runId } = await queue('hello')
      await repository.claimDueBatch(1)
      await prisma.aiRunAttempt.updateMany({ where: { runId }, data: { ioStartedAt: new Date() } })
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      })

      await repository.reapExpiredLeases()

      expect((await getRun(runId)).attemptCount).toBe(1)
    })

    it('a run whose history is full is failed attempts_exhausted, never claimed again, no row evicted', async () => {
      const { runId } = await queue('hello')
      await prisma.aiRun.update({ where: { id: runId }, data: { leaseEpoch: 128 } })

      expect(await repository.claimDueBatch(1)).toHaveLength(0) // not claimable at the cap
      expect(await repository.failEpochCappedRuns()).toBe(1)

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.FAILED)
      expect(run.errorCode).toBe('attempt_history_exhausted')
      expect(run.terminalReasonCode).toBe('attempts_exhausted')
    })

    it('a QUEUED cancel skips an approved-but-not-started tool (it never runs) and keeps the approval trail', async () => {
      const { userId, runId } = await queue('__mock_tool__:demo_sensitive', true)
      await dispatch.drainDueBatches()
      const approval = await prisma.aiApproval.findFirstOrThrow({ where: { runId } })
      await approvals.decide(userId, approval.id, { decision: 'approve' }) // run is QUEUED, tool APPROVED

      await runService.cancel(userId, runId)

      expect((await getRun(runId)).status).toBe(AiRunStatus.CANCELLED)
      const [invocation] = await prisma.aiToolInvocation.findMany({ where: { runId } })
      expect(invocation!.status).toBe(AiToolInvocationStatus.SKIPPED)
      expect(controls.toolCalls).toHaveLength(0)
    })
  })

  describe('idempotent replay (real producer, real Postgres)', () => {
    it('same key + same input returns the SAME run and creates nothing; a different input conflicts', async () => {
      const userId = await createUser()
      const conversationId = await createConversation(userId)
      const first = await producer.create(userId, {
        conversationId,
        inputParts: [{ type: 'text', text: 'hello' }],
        idempotencyKey: 'order-1',
      })

      const replay = await producer.create(userId, {
        conversationId,
        inputParts: [{ type: 'text', text: 'hello' }],
        idempotencyKey: 'order-1',
      })
      expect(replay.id).toBe(first.id)
      expect(await prisma.aiRun.count({ where: { conversationId } })).toBe(1)
      expect(await prisma.aiMessage.count({ where: { conversationId } })).toBe(1)

      await expect(
        producer.create(userId, {
          conversationId,
          inputParts: [{ type: 'text', text: 'something else' }],
          idempotencyKey: 'order-1',
        })
      ).rejects.toMatchObject({ errorCode: 'AI_RUN_IDEMPOTENCY_CONFLICT', status: 409 })
      expect(await prisma.aiRun.count({ where: { conversationId } })).toBe(1)
    })

    it('concurrent identical requests produce ONE run', async () => {
      const userId = await createUser()
      const conversationId = await createConversation(userId)
      const request = {
        conversationId,
        inputParts: [{ type: 'text' as const, text: 'hello' }],
        idempotencyKey: 'order-2',
      }

      const results = await Promise.all(
        Array.from({ length: 5 }, () => producer.create(userId, request))
      )

      expect(new Set(results.map((r) => r.id)).size).toBe(1)
      expect(await prisma.aiRun.count({ where: { conversationId } })).toBe(1)
    })

    it('a legacy run (NULL fingerprint) is compared against its own USER turn, then backfilled', async () => {
      const userId = await createUser()
      const conversationId = await createConversation(userId)
      const first = await producer.create(userId, {
        conversationId,
        inputParts: [{ type: 'text', text: 'hello' }],
        idempotencyKey: 'legacy-1',
      })
      await prisma.aiRun.update({ where: { id: first.id }, data: { inputFingerprint: null } }) // pre-fingerprint run

      const same = await producer.create(userId, {
        conversationId,
        inputParts: [{ type: 'text', text: 'hello' }],
        idempotencyKey: 'legacy-1',
      })
      expect(same.id).toBe(first.id)
      expect((await getRun(first.id)).inputFingerprint).toMatch(/^v1:/) // backfilled

      await prisma.aiRun.update({ where: { id: first.id }, data: { inputFingerprint: null } })
      await expect(
        producer.create(userId, {
          conversationId,
          inputParts: [{ type: 'text', text: 'different' }],
          idempotencyKey: 'legacy-1',
        })
      ).rejects.toMatchObject({ errorCode: 'AI_RUN_IDEMPOTENCY_CONFLICT' })
      expect((await getRun(first.id)).inputFingerprint).toBeNull() // a conflicting replay backfills nothing
    })

    it('a legacy run whose original USER turn is missing fails closed', async () => {
      const userId = await createUser()
      const conversationId = await createConversation(userId)
      const first = await producer.create(userId, {
        conversationId,
        inputParts: [{ type: 'text', text: 'hello' }],
        idempotencyKey: 'legacy-2',
      })
      await prisma.aiRun.update({ where: { id: first.id }, data: { inputFingerprint: null } })
      await prisma.aiMessage.deleteMany({ where: { runId: first.id } })

      await expect(
        producer.create(userId, {
          conversationId,
          inputParts: [{ type: 'text', text: 'hello' }],
          idempotencyKey: 'legacy-2',
        })
      ).rejects.toMatchObject({ errorCode: 'AI_RUN_IDEMPOTENCY_CONFLICT' })
    })
  })

  describe('lock order: approve / cancel / expiry / takeover / reaper never deadlock', () => {
    async function parkedRun(): Promise<{
      userId: string
      runId: string
      approvalId: string
      conversationId: string
    }> {
      const { userId, runId, conversationId } = await queue('__mock_tool__:demo_sensitive', true)
      await dispatch.drainDueBatches()
      const approval = await prisma.aiApproval.findFirstOrThrow({ where: { runId } })
      expect(approval.state).toBe(AiApprovalState.PENDING)
      return { userId, runId, approvalId: approval.id, conversationId }
    }

    it('concurrent decide, cancel, expiry sweep, takeover and reaper over parked and running runs finish with no deadlock', async () => {
      const failures: string[] = []
      const note = (label: string) => (result: PromiseSettledResult<unknown>) => {
        if (result.status === 'rejected') {
          const message = String((result.reason as Error)?.message ?? result.reason)
          // A conflict/404 from losing a race is a normal outcome; a Postgres deadlock or lock timeout is a bug.
          if (/deadlock|40P01|lock timeout|55P03/i.test(message))
            failures.push(`${label}: ${message}`)
        }
      }

      for (let round = 0; round < 6; round += 1) {
        // Park sequentially: concurrent drains would compete for the two lanes and park each other's runs.
        const parked = [await parkedRun(), await parkedRun(), await parkedRun()]
        // Make every approval due so the expiry sweep contends with the others.
        await prisma.aiApproval.updateMany({
          where: { runId: { in: parked.map((p) => p.runId) } },
          data: { expiresAt: new Date(Date.now() - 1000) },
        })
        const [a, b, c] = parked as [
          (typeof parked)[number],
          (typeof parked)[number],
          (typeof parked)[number],
        ]
        const results = await Promise.allSettled([
          approvals.decide(a.userId, a.approvalId, { decision: 'approve' }),
          runService.cancel(a.userId, a.runId),
          runService.cancel(b.userId, b.runId),
          approvals.decide(b.userId, b.approvalId, { decision: 'reject' }),
          expiry.expireDue(),
          control.takeControl({ userId: c.userId, isSuperAdmin: false } as never, c.conversationId),
          dispatch.reap(),
          dispatch.drainDueBatches(),
        ])
        results.forEach((r, i) => note(`round ${round} op ${i}`)(r))
      }

      expect(failures).toEqual([])
    })
  })
})
