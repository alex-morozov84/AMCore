import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiApprovalService } from '../src/core/ai/approvals/ai-approval.service'
import { AiRunService } from '../src/core/ai/runs/ai-run.service'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AiRunGuard } from '../src/infrastructure/ai/runs/ai-run-guard.service'
import { AiRunTransitions } from '../src/infrastructure/ai/runs/ai-run-transitions.service'
import { AiToolActionService } from '../src/infrastructure/ai/runs/ai-tool-action.service'
import { AI_TOOLS } from '../src/infrastructure/ai/tools/ai-tool.types'
import type { PrismaService } from '../src/prisma'

import {
  archiveDocumentTool,
  ControllableAdapter,
  controls,
  deferred,
  lookupItemTool,
  until,
} from './fixtures/ai-run-controls'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import {
  AiMessageRole,
  AiRunAttemptOutcome,
  AiRunStatus,
  AiToolInvocationStatus,
  Prisma,
} from '@/generated/prisma/client'

/**
 * AI run execution ownership, cancel/deadline and tool-effect (E12) proofs over REAL Postgres + the real
 * durable worker (Track C — ADR-054). Unit specs mock Prisma, so they cannot prove what these do: the
 * lease/epoch fence under row locks, a stale executor writing nothing, a cancel observed between steps,
 * the deadline aborting an in-flight call, and — the point of E12 — that a tool timeout or crash never
 * produces a second effect. A controllable provider adapter and two fixture tools (an external-effect
 * ledger) give exact barriers; no real minutes are waited and no real provider is called.
 */
process.env.AI_TOOL_EXECUTION_TIMEOUT_MS = '400' // a tool "times out" after 400 ms in these suites

describe('AI run ownership, cancel/deadline and tool effects (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let repository: AiRunRepository
  let guard: AiRunGuard
  let transitions: AiRunTransitions
  let actions: AiToolActionService
  let runService: AiRunService
  let approvals: AiApprovalService

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder
        .overrideProvider(AI_TOOLS)
        .useValue([archiveDocumentTool, lookupItemTool])
        .overrideProvider(AI_PROVIDER_ADAPTERS)
        .useValue([new ControllableAdapter()])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    repository = app.get(AiRunRepository, { strict: false })
    guard = app.get(AiRunGuard, { strict: false })
    transitions = app.get(AiRunTransitions, { strict: false })
    actions = app.get(AiToolActionService, { strict: false })
    runService = app.get(AiRunService, { strict: false })
    approvals = app.get(AiApprovalService, { strict: false })
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
    const email = `ai-own-${Date.now()}-${seq}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
      select: { id: true },
    })
    return user.id
  }

  /** A conversation bound to an enabled assistant that allowlists the two fixture tools. */
  async function createConversation(userId: string): Promise<string> {
    seq += 1
    const assistant = await prisma.aiAssistant.create({
      data: {
        slug: `own-${Date.now()}-${seq}`,
        version: 1,
        displayName: 'Ownership assistant',
        enabled: true,
        modelSelection: { modelSlug: 'mock-default' },
        allowedModalities: ['text'],
        toolAllowlist: ['archive_document', 'lookup_item'],
      },
      select: { id: true },
    })
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId, assistantId: assistant.id },
      select: { id: true },
    })
    return conv.id
  }

  interface Queued {
    userId: string
    conversationId: string
    runId: string
  }

  /** Queue a run through the real producer (frozen snapshot, USER turn bound by runId, deadline). */
  async function queue(text: string, idempotencyKey?: string): Promise<Queued> {
    const userId = await createUser()
    const conversationId = await createConversation(userId)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text }],
      ...(idempotencyKey ? { idempotencyKey } : {}),
    })
    return { userId, conversationId, runId: run.id }
  }

  const getRun = (runId: string) => prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
  const invocations = (runId: string) =>
    prisma.aiToolInvocation.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } })
  const attempts = (runId: string) =>
    prisma.aiRunAttempt.findMany({ where: { runId }, orderBy: { epoch: 'asc' } })

  /** Claim exactly one due run like a dispatch lane does. */
  async function claimOne(): Promise<
    NonNullable<Awaited<ReturnType<typeof repository.claimDueBatch>>[number]>
  > {
    const [claim] = await repository.claimDueBatch(1)
    if (!claim) throw new Error('nothing claimable')
    return claim
  }

  describe('E1 — capacity and lease start (no batch-tail waste)', () => {
    it('keeps both slots for timed-out tools after their provider calls settled; the tail stays unclaimed', async () => {
      const queued = await Promise.all(
        Array.from({ length: 6 }, () => queue('__mock_tool__:archive_document'))
      )
      const release = deferred()
      controls.afterEffect = () => release.promise // ignores abort and remains physically pending
      const drain = dispatch.drainDueBatches()
      try {
        await until(() => controls.toolCalls.length >= 2)
        await drain // the local tool timeout ends logical work, not physical execution
        expect(controls.toolCalls).toHaveLength(2)
        expect(controls.providerCalls).toBe(2)
        const tail = await prisma.aiRun.findMany({
          where: { id: { in: queued.map((q) => q.runId) }, status: AiRunStatus.QUEUED },
        })
        expect(tail).toHaveLength(4)
        expect(tail.every((r) => r.leaseEpoch === 0 && r.attemptCount === 0)).toBe(true)
        expect(
          await prisma.aiRunAttempt.count({ where: { runId: { in: tail.map((r) => r.id) } } })
        ).toBe(0)
      } finally {
        release.resolve()
        await drain
        await new Promise((resolve) => setImmediate(resolve))
      }
    })

    it('claims one run per lane: untouched runs keep zero epochs, attempts and retries while two lanes are busy', async () => {
      const queued = await Promise.all(Array.from({ length: 6 }, () => queue('hello')))
      const release = deferred()
      controls.providerHook = () => release.promise // every provider call blocks on the barrier

      const drain = Promise.all([dispatch.drainDueBatches(), dispatch.drainDueBatches()])
      await until(() => controls.providerInFlight === 2)
      await new Promise((resolve) => setTimeout(resolve, 150)) // let any (wrong) extra claim happen

      const runs = await prisma.aiRun.findMany({
        where: { id: { in: queued.map((q) => q.runId) } },
      })
      const running = runs.filter((r) => r.status === AiRunStatus.RUNNING)
      const untouched = runs.filter((r) => r.status === AiRunStatus.QUEUED)
      expect(running).toHaveLength(2) // the per-process gate: two lanes, shared by both overlapping drains
      expect(controls.providerMaxInFlight).toBe(2)
      expect(untouched).toHaveLength(4)
      // The tail was never claimed: no lease, no epoch, no attempt row, no retry spent.
      for (const run of untouched) {
        expect(run.leaseEpoch).toBe(0)
        expect(run.attemptCount).toBe(0)
        expect(run.leaseToken).toBeNull()
      }
      expect(
        await prisma.aiRunAttempt.count({ where: { runId: { in: untouched.map((r) => r.id) } } })
      ).toBe(0)

      release.resolve()
      await drain
      await dispatch.drainDueBatches()
      await dispatch.drainDueBatches()
      const done = await prisma.aiRun.findMany({
        where: { id: { in: queued.map((q) => q.runId) } },
      })
      expect(done.every((r) => r.status === AiRunStatus.COMPLETED)).toBe(true)
      expect(done.every((r) => r.attemptCount === 0)).toBe(true) // success spends no retry budget
    })
  })

  describe('E4 — only the current lease holder writes', () => {
    it('an executor whose lease was reaped and re-claimed writes NOTHING (no step, no ledger, no invocation, no terminal)', async () => {
      const { runId } = await queue('hello')
      const stale = await claimOne()
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
      })
      await repository.reapExpiredLeases()
      const current = await claimOne()
      expect(current.epoch).toBe(2)
      expect(current.leaseToken).not.toBe(stale.leaseToken)

      const outcome = await guard.record(stale, async (tx) => {
        await tx.aiRunStep.create({ data: { runId, stepNumber: 1, type: 'PROVIDER_CALL' } })
      })
      expect(outcome.kind).toBe('lease_lost')
      expect(await transitions.failed(stale, 'provider_rejected')).toBe('lease_lost')
      expect(await transitions.retry(stale, 'provider_timeout')).toEqual({ state: 'lease_lost' })

      expect(await prisma.aiRunStep.count({ where: { runId } })).toBe(0)
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(0)
      expect(await invocations(runId)).toHaveLength(0)
      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.RUNNING) // still the NEW holder's
      expect(run.leaseToken).toBe(current.leaseToken)
    })

    it('an expired-but-not-reaped lease cannot be renewed or used to write (an expired lease is never revived)', async () => {
      const { runId } = await queue('hello')
      const claim = await claimOne()
      const expiredAt = new Date(Date.now() - 5_000)
      await prisma.aiRun.update({ where: { id: runId }, data: { leaseExpiresAt: expiredAt } })

      expect((await guard.admit(claim, async () => 'x')).kind).toBe('lease_lost')
      expect((await guard.record(claim, async () => 'x')).kind).toBe('lease_lost')
      expect((await getRun(runId)).leaseExpiresAt?.getTime()).toBe(expiredAt.getTime()) // not extended
    })

    it('a lock wait that outlives the lease is refused AFTER the lock is granted (fresh-clock check, not a pre-lock predicate)', async () => {
      const { runId } = await queue('hello')
      const claim = await claimOne()
      // Make the lease expire in 300 ms, then hold the run row locked for 800 ms in another transaction.
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() + 300) },
      })
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "ai"."ai_runs" WHERE id = ${runId} FOR UPDATE`)
        await new Promise((resolve) => setTimeout(resolve, 800))
      })
      await new Promise((resolve) => setTimeout(resolve, 100)) // the holder owns the lock now

      const outcome = await guard.admit(claim, async () => 'x') // waits on the lock, then finds the lease expired
      await holder

      expect(outcome.kind).toBe('lease_lost')
    })

    it('takeover during the provider call: the spend is recorded, NO assistant turn is written, the run ends superseded', async () => {
      const { runId, conversationId } = await queue('hello')
      controls.providerHook = async () => {
        await prisma.aiConversation.update({
          where: { id: conversationId },
          data: {
            controlledBy: 'HUMAN',
            state: 'PAUSED_FOR_HUMAN',
            ownershipGeneration: { increment: 1 },
          },
        })
      }

      await dispatch.drainDueBatches()

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.CANCELLED)
      expect(run.terminalReasonCode).toBe('superseded_by_human')
      expect(
        await prisma.aiMessage.count({ where: { runId, role: AiMessageRole.ASSISTANT } })
      ).toBe(0)
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(1) // the call happened: spend kept
      expect((await attempts(runId)).map((a) => a.outcome)).toEqual([
        AiRunAttemptOutcome.SUPERSEDED,
      ])
    })

    it('two continuations with the SAME claim execute a requested SAFE action once (one invocation, one effect, one application)', async () => {
      const { runId } = await queue('hello')
      const claim = await claimOne()
      const plan = {
        modelSlug: 'mock-default',
        attribution: { userId: 'u', organizationId: null },
      } as never
      const result = {
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        modelSlug: 'mock-default',
        providerType: 'MOCK',
      } as never

      const [a, b] = await Promise.all([
        actions.requestAction(claim, plan, result, 1, 1, archiveDocumentTool, {}),
        actions.requestAction(claim, plan, result, 1, 1, archiveDocumentTool, {}),
      ])

      const created = [a, b].filter((r) => r.kind === 'ready')
      expect(created.length).toBeGreaterThanOrEqual(1)
      expect(await invocations(runId)).toHaveLength(1) // one requested action = one invocation row
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(1)
      const action = (await invocations(runId))[0]!
      expect(action.originCall).toBe(1)

      const ctx = {
        claim,
        ownerUserId: 'u',
        organizationId: null,
        runtime: {
          attempt: { signal: new AbortController().signal },
          onTransportStarted: () => undefined,
        },
      } as never
      const steps = await Promise.all([
        actions.execute(ctx, action as never, archiveDocumentTool, 'c1', {}),
        actions.execute(ctx, action as never, archiveDocumentTool, 'c1', {}),
      ])

      expect(controls.effects).toHaveLength(1) // ONE physical effect
      expect(steps.filter((s) => s.status === 'succeeded')).toHaveLength(1)
      expect(await prisma.aiRunStep.count({ where: { runId, type: 'TOOL_INVOCATION' } })).toBe(1) // applied once
    })

    it('a different input for the same requested action fails closed (action_input_conflict) with no tool call', async () => {
      const { runId } = await queue('hello')
      const claim = await claimOne()
      const plan = {
        modelSlug: 'mock-default',
        attribution: { userId: 'u', organizationId: null },
      } as never
      const result = {
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        modelSlug: 'mock-default',
        providerType: 'MOCK',
      } as never
      expect(
        (await actions.requestAction(claim, plan, result, 1, 1, archiveDocumentTool, {})).kind
      ).toBe('ready')

      const second = await actions.requestAction(claim, plan, result, 1, 1, archiveDocumentTool, {
        documentId: 'other',
      })

      expect(second.kind).toBe('terminal')
      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.FAILED)
      expect(run.terminalReasonCode).toBe('action_input_conflict')
      expect(controls.toolCalls).toHaveLength(0)
    })
  })

  describe('E5 — cancel, default deadline and stop precedence', () => {
    it('stamps the default lifetime on creation as EXACTLY createdAt + AI_RUN_DEADLINE_MS (database time)', async () => {
      const { runId } = await queue('hello')
      const run = await getRun(runId)
      expect(run.deadlineAt).toBeInstanceOf(Date)
      expect(run.deadlineAt!.getTime() - run.createdAt.getTime()).toBe(172_800_000)
    })

    it('cancel during the provider call: usage is recorded, the next tool and provider never start, the run ends CANCELLED', async () => {
      const { runId, userId } = await queue('__mock_tool__:archive_document')
      controls.providerHook = async () => {
        await runService.cancel(userId, runId) // the user cancels while the provider call is in flight
      }

      await dispatch.drainDueBatches()

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.CANCELLED)
      expect(run.terminalReasonCode).toBe('cancelled_by_user')
      expect(run.cancellationRequestedAt).toBeInstanceOf(Date)
      expect(controls.toolCalls).toHaveLength(0) // the requested tool never started
      expect(await invocations(runId)).toHaveLength(0) // not even an intent
      expect(controls.providerCalls).toBe(1) // no further provider call
      expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBe(1) // returned usage is kept
    })

    it('cancel during a tool: its known outcome is recorded (not erased), nothing further starts', async () => {
      const { runId, userId } = await queue('__mock_tool__:archive_document')
      controls.afterEffect = async () => {
        await runService.cancel(userId, runId) // cancel lands after the effect, before the result is recorded
      }

      await dispatch.drainDueBatches()

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.CANCELLED)
      expect(controls.effects).toHaveLength(1)
      const [inv] = await invocations(runId)
      expect(inv!.status).toBe(AiToolInvocationStatus.SUCCEEDED) // the accepted effect stays observable
      expect(inv!.appliedAt).toBeNull() // …but is not applied to a transcript that will never continue
      expect(controls.providerCalls).toBe(1)
      expect(await prisma.aiRunStep.count({ where: { runId, type: 'TOOL_INVOCATION' } })).toBe(0)
    })

    it('a deadline that passes inside the provider call aborts it and EXPIRES the run — it is not retried as a provider fault', async () => {
      const { runId } = await queue('hello')
      await prisma.aiRun.update({
        where: { id: runId },
        data: { deadlineAt: new Date(Date.now() + 400) },
      })
      controls.providerHook = (call) =>
        new Promise<void>((resolve) => {
          const signal = call.abortSignal
          if (!signal) return resolve()
          if (signal.aborted) return resolve()
          signal.addEventListener('abort', () => resolve())
        })

      await dispatch.drainDueBatches()

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.EXPIRED)
      expect(run.terminalReasonCode).toBe('deadline_exceeded')
      expect(run.attemptCount).toBe(0) // no retry budget consumed
      expect(controls.providerCalls).toBe(1)
    })

    it('a cancel recorded on a reaped RUNNING run turns it CANCELLED, not a requeue or a failure', async () => {
      const { runId } = await queue('hello')
      await claimOne()
      await prisma.aiRun.update({
        where: { id: runId },
        data: { leaseExpiresAt: new Date(Date.now() - 1000), cancellationRequestedAt: new Date() },
      })

      await repository.reapExpiredLeases()

      const run = await getRun(runId)
      expect(run.status).toBe(AiRunStatus.CANCELLED)
      expect(run.terminalReasonCode).toBe('cancelled_by_user')
    })

    it('precedence: a recorded cancel wins over a takeover seen at the same admission', async () => {
      const { runId, conversationId } = await queue('hello')
      const claim = await claimOne()
      await prisma.aiRun.update({
        where: { id: runId },
        data: { cancellationRequestedAt: new Date() },
      })
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: { controlledBy: 'HUMAN', ownershipGeneration: { increment: 1 } },
      })

      const outcome = await guard.admit(claim, async () => 'x')

      expect(outcome).toEqual({ kind: 'stopped', cause: 'cancelled' })
    })

    it('cancel of a WAITING_APPROVAL run racing the approval never loses the cancel (20 schedules)', async () => {
      const outcomes: string[] = []
      for (let i = 0; i < 20; i += 1) {
        const userId = await createUser()
        const conversationId = await createConversation(userId)
        const created = await producer.create(userId, {
          conversationId,
          inputParts: [{ type: 'text', text: 'x' }],
        })
        // Park by hand: a RUNNING run waiting behind a pending approval for a gated invocation.
        const run = await prisma.aiRun.update({
          where: { id: created.id },
          data: { status: AiRunStatus.WAITING_APPROVAL, attemptCount: 0 },
        })
        const approval = await prisma.aiApproval.create({
          data: {
            runId: run.id,
            conversationId,
            kind: 'TOOL_INVOCATION',
            state: 'PENDING',
            expiresAt: new Date(Date.now() + 60_000),
          },
        })
        await prisma.aiToolInvocation.create({
          data: {
            runId: run.id,
            toolId: 'archive_document',
            status: 'AWAITING_APPROVAL',
            riskClass: 'SAFE',
            idempotency: 'idempotent',
            originCall: 1,
            approvalId: approval.id,
            argsSnapshot: {},
          },
        })

        const [cancelResult] = await Promise.allSettled([
          runService.cancel(userId, run.id),
          approvals.decide(userId, approval.id, { decision: 'approve' }),
        ])
        expect(cancelResult.status).toBe('fulfilled')

        const after = await getRun(run.id)
        // Whatever the interleaving: the cancel took effect (terminal) or was recorded for the worker to
        // observe — it is NEVER silently dropped (the race the single-transaction cancel closes).
        expect(
          after.status === AiRunStatus.CANCELLED || after.cancellationRequestedAt !== null
        ).toBe(true)
        outcomes.push(after.status)
        const leftover = await prisma.aiApproval.count({
          where: { runId: run.id, state: 'PENDING' },
        })
        expect(leftover).toBe(0) // no orphan pending approval
      }
      expect(outcomes.every((o) => o === 'CANCELLED' || o === 'QUEUED')).toBe(true)
    })
  })

  describe('E12 — a tool timeout or crash never produces a second effect', () => {
    /** Run `archive_document` to its tool step with the effect ledger observable. */
    async function runToTool(): Promise<Queued> {
      const queued = await queue('__mock_tool__:archive_document')
      await dispatch.drainDueBatches()
      return queued
    }

    it('accepted-but-timeout: the effect happens once, the outcome is UNKNOWN, the run stops uncertain, nothing is replayed', async () => {
      const lateReply = deferred()
      controls.afterEffect = () => lateReply.promise
      try {
        const { runId } = await runToTool()

        expect(controls.effects).toHaveLength(1)
        const [inv] = await invocations(runId)
        expect(inv!.status).toBe(AiToolInvocationStatus.OUTCOME_UNKNOWN)
        expect(inv!.errorCode).toBe('tool_effect_unknown')
        const run = await getRun(runId)
        expect(run.status).toBe(AiRunStatus.FAILED)
        expect(run.terminalReasonCode).toBe('tool_effect_unknown')
        expect((await attempts(runId)).map((a) => a.outcome)).toEqual([
          AiRunAttemptOutcome.EFFECT_UNKNOWN,
        ])

        // Recovery later: no new model request, no new invocation, no second effect.
        const providerCallsBefore = controls.providerCalls
        await dispatch.runDispatchCycle()
        await dispatch.runDispatchCycle()
        expect(controls.providerCalls).toBe(providerCallsBefore)
        expect(await invocations(runId)).toHaveLength(1)
        expect(controls.effects).toHaveLength(1)
      } finally {
        lateReply.resolve()
        await new Promise((resolve) => setImmediate(resolve))
      }
    })

    it('crash after an accepted effect (EXECUTING stranded, lease expires): recovery fails UNCERTAIN — zero replay calls, no new model request', async () => {
      const { runId } = await queue('__mock_tool__:archive_document')
      // Drive the worker up to "the tool is executing" and then simulate the crash by never recording.
      const crashed = deferred()
      controls.beforeEffect = async () => {
        await prisma.aiRun.update({
          where: { id: runId },
          data: { leaseExpiresAt: new Date(Date.now() - 1) },
        })
        // the process "dies" here: the effect happens, but the result is never recorded
      }
      controls.afterEffect = async () => {
        await crashed.promise
      }
      const drain = dispatch.drainDueBatches()
      await until(() => controls.effects.length === 1)
      // A new worker's cycle reaps the dead lease, re-claims the run and runs recovery.
      await dispatch.reap()
      expect((await getRun(runId)).status).toBe(AiRunStatus.QUEUED)
      // The reaped attempt may have started I/O, so one retry is consumed and a backoff applies: fast-forward it.
      await prisma.aiRun.update({
        where: { id: runId },
        data: { nextAttemptAt: new Date(Date.now() - 1) },
      })
      const providerCallsBefore = controls.providerCalls
      const toolCallsBefore = controls.toolCalls.length

      await dispatch.runDispatchCycle()

      expect(controls.effects).toHaveLength(1) // still ONE effect
      expect(controls.toolCalls).toHaveLength(toolCallsBefore) // the tool was NOT called again
      expect(controls.providerCalls).toBe(providerCallsBefore) // the model was NOT asked again
      const [inv] = await invocations(runId)
      expect(inv!.status).toBe(AiToolInvocationStatus.OUTCOME_UNKNOWN)
      expect((await getRun(runId)).terminalReasonCode).toBe('tool_effect_unknown')
      crashed.resolve()
      await drain
      // The stale first holder's late result is discarded: the authoritative outcome stays intact.
      expect((await invocations(runId))[0]!.status).toBe(AiToolInvocationStatus.OUTCOME_UNKNOWN)
      expect((await getRun(runId)).status).toBe(AiRunStatus.FAILED)
    })

    it('an ordinary throw AFTER the effect is also uncertain (a local exception can follow a remote success)', async () => {
      controls.afterEffect = async () => {
        throw new Error('connection reset after the request was accepted')
      }

      const { runId } = await runToTool()

      const [inv] = await invocations(runId)
      expect(inv!.status).toBe(AiToolInvocationStatus.OUTCOME_UNKNOWN)
      expect(controls.effects).toHaveLength(1)
    })

    it('a read-only tool failure is a plain FAILED (no effect to be unsure about) and the run fails without a replay', async () => {
      controls.afterEffect = async () => {
        throw new Error('db blip')
      }
      const queued = await queue('__mock_tool__:lookup_item')

      await dispatch.drainDueBatches()

      const [inv] = await invocations(queued.runId)
      expect(inv!.status).toBe(AiToolInvocationStatus.FAILED)
      expect((await getRun(queued.runId)).status).toBe(AiRunStatus.FAILED)
      expect(controls.toolCalls).toHaveLength(1)
    })

    it('a read-only EXECUTING stranded by a crash is ADOPTED by the next epoch and re-run safely (one more call)', async () => {
      const queued = await queue('__mock_tool__:lookup_item')
      const crashed = deferred()
      const executing = deferred()
      controls.beforeEffect = async () => {
        await prisma.aiRun.update({
          where: { id: queued.runId },
          data: { leaseExpiresAt: new Date(Date.now() - 1) },
        })
      }
      controls.afterEffect = async () => {
        controls.afterEffect = undefined // the second execution is not blocked
        controls.beforeEffect = undefined
        executing.resolve()
        await crashed.promise
      }
      const drain = dispatch.drainDueBatches()
      await executing.promise // the lease-expiry write completed before the reaper runs
      await dispatch.reap()
      await prisma.aiRun.update({
        where: { id: queued.runId },
        data: { nextAttemptAt: new Date(Date.now() - 1) },
      })

      await dispatch.runDispatchCycle()

      expect(controls.toolCalls.length).toBeGreaterThanOrEqual(2) // adopted and repeated: read-only is safe
      expect((await getRun(queued.runId)).status).toBe(AiRunStatus.COMPLETED)
      crashed.resolve()
      await drain
      const [inv] = await invocations(queued.runId)
      expect(inv!.status).toBe(AiToolInvocationStatus.SUCCEEDED)
      expect(inv!.executionEpoch).toBe(2)
    })

    it('completes normally: one intent, one effect, one application, history shows one successful attempt', async () => {
      const { runId } = await runToTool()

      expect((await getRun(runId)).status).toBe(AiRunStatus.COMPLETED)
      expect(controls.effects).toHaveLength(1)
      const [inv] = await invocations(runId)
      expect(inv!.status).toBe(AiToolInvocationStatus.SUCCEEDED)
      expect(inv!.appliedAt).toBeInstanceOf(Date)
      expect(inv!.originCall).toBe(1)
      expect(inv!.executionEpoch).toBe(1)
      expect(inv!.idempotency).toBe('idempotent')
      expect((await attempts(runId)).map((a) => [a.epoch, a.outcome])).toEqual([
        [1, AiRunAttemptOutcome.SUCCEEDED],
      ])
      expect((await attempts(runId))[0]!.ioStartedAt).toBeInstanceOf(Date)
    })
  })
})
