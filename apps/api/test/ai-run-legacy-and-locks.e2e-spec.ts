import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiConversationControlService } from '../src/core/ai/conversations/ai-conversation-control.service'
import { AiRunService } from '../src/core/ai/runs/ai-run.service'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AI_TOOLS } from '../src/infrastructure/ai/tools/ai-tool.types'
import type { PrismaService } from '../src/prisma'

import {
  archiveDocumentTool,
  ControllableAdapter,
  controls,
  deferred,
} from './fixtures/ai-run-controls'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import {
  AiApprovalState,
  AiRunStatus,
  AiToolInvocationStatus,
  AiToolRiskClass,
} from '@/generated/prisma/client'

/**
 * Mixed legacy tool state and queued cancel/takeover lock order, over REAL Postgres (Track C — ADR-054).
 * These pin two interactions a randomized run cannot prove: (1) an OLDER unknown side effect must stop the
 * run even when a NEWER executable action exists (conversion preserves legacy rows; "the newest one" is not
 * enough), and an ambiguous set of pending legacy actions fails closed; (2) a queued run being cancelled
 * and the same conversation being taken over must obey the global lock order run → invocation — the
 * schedule is forced with barriers, so a reversed order shows up as a deadlock, deterministically.
 */
const sensitiveArchive = {
  ...archiveDocumentTool,
  toolId: 'sensitive_archive',
  riskClass: AiToolRiskClass.SENSITIVE,
}

describe('AI run legacy tool state and queued lock order (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let runService: AiRunService
  let control: AiConversationControlService
  let seq = 0

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder
        .overrideProvider(AI_TOOLS)
        .useValue([archiveDocumentTool, sensitiveArchive])
        .overrideProvider(AI_PROVIDER_ADAPTERS)
        .useValue([new ControllableAdapter()])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    runService = app.get(AiRunService, { strict: false })
    control = app.get(AiConversationControlService, { strict: false })
    for (const job of app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      job.stop()
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

  async function queue() {
    seq += 1
    const user = await prisma.user.create({
      data: {
        email: `legacy-${seq}@example.com`,
        emailCanonical: `legacy-${seq}@example.com`,
        passwordHash: 'x',
      },
    })
    const assistant = await prisma.aiAssistant.create({
      data: {
        slug: `legacy-${seq}`,
        version: 1,
        displayName: 'Legacy',
        enabled: true,
        modelSelection: { modelSlug: 'mock-default' },
        toolAllowlist: ['archive_document', 'sensitive_archive'],
        allowedModalities: ['text'],
      },
    })
    const conversation = await prisma.aiConversation.create({
      data: { ownerUserId: user.id, assistantId: assistant.id },
    })
    const run = await producer.create(user.id, {
      conversationId: conversation.id,
      inputParts: [{ type: 'text', text: 'hello' }],
    })
    return { user, conversation, run }
  }

  async function approvedSensitiveInvocation(
    runId: string,
    conversationId: string,
    userId: string,
    status: AiToolInvocationStatus = AiToolInvocationStatus.APPROVED
  ) {
    const approval = await prisma.aiApproval.create({
      data: {
        runId,
        conversationId,
        kind: 'TOOL_INVOCATION',
        state: AiApprovalState.APPROVED,
        decidedById: userId,
        decidedAt: new Date(),
      },
    })
    return prisma.aiToolInvocation.create({
      data: {
        runId,
        toolId: 'sensitive_archive',
        riskClass: AiToolRiskClass.SENSITIVE,
        approvalId: approval.id,
        status,
        argsSnapshot: {},
      },
    })
  }

  describe('unknown effect precedence (mixed legacy conversion output)', () => {
    it('an OLDER OUTCOME_UNKNOWN blocks a NEWER approved action: no tool call, no model call, run fails uncertain', async () => {
      const { run, user, conversation } = await queue()
      await prisma.aiToolInvocation.create({
        data: {
          runId: run.id,
          toolId: 'archive_document',
          riskClass: AiToolRiskClass.SAFE,
          status: AiToolInvocationStatus.OUTCOME_UNKNOWN,
          argsSnapshot: {},
          createdAt: new Date(Date.now() - 60_000),
        },
      })
      await approvedSensitiveInvocation(run.id, conversation.id, user.id)

      await dispatch.drainDueBatches()

      const state = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(controls.toolCalls).toHaveLength(0) // the approved action was NOT executed
      expect(controls.providerCalls).toBe(0) // the model was NOT asked
      expect(state.status).toBe(AiRunStatus.FAILED)
      expect(state.terminalReasonCode).toBe('tool_effect_unknown')
      // The uncertain evidence is preserved, and the unstarted action is skipped rather than run.
      const rows = await prisma.aiToolInvocation.findMany({
        where: { runId: run.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(rows.map((r) => r.status)).toEqual([
        AiToolInvocationStatus.OUTCOME_UNKNOWN,
        AiToolInvocationStatus.SKIPPED,
      ])
    })

    it('several pending legacy actions are ambiguous: fail closed, nothing executes', async () => {
      const { run, user, conversation } = await queue()
      await prisma.aiToolInvocation.create({
        data: {
          runId: run.id,
          toolId: 'archive_document',
          riskClass: AiToolRiskClass.SAFE,
          status: AiToolInvocationStatus.REQUESTED,
          argsSnapshot: {},
          createdAt: new Date(Date.now() - 60_000),
        },
      })
      await approvedSensitiveInvocation(run.id, conversation.id, user.id)

      await dispatch.drainDueBatches()

      const state = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(controls.toolCalls).toHaveLength(0)
      expect(controls.providerCalls).toBe(0)
      expect(state.status).toBe(AiRunStatus.FAILED)
      expect(state.terminalReasonCode).toBe('tool_state_inconsistent')
    })
  })

  describe('queued cancel and takeover on the same conversation (lock order run → invocation)', () => {
    it('with the cancel holding the queued run and about to update its invocation, a concurrent takeover waits for the RUN first — no deadlock', async () => {
      const { user, conversation, run } = await queue()
      const invocation = await approvedSensitiveInvocation(run.id, conversation.id, user.id)

      // Emulate the cancel's own lock sequence deterministically: it holds the queued run's row lock, signals
      // that it does, then (only after the takeover has started) updates the invocation and commits.
      const runLocked = deferred()
      const takeoverStarted = deferred()
      const cancel = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ai"."ai_runs" WHERE id = ${run.id} FOR UPDATE`
        runLocked.resolve()
        await takeoverStarted.promise
        await new Promise((resolve) => setTimeout(resolve, 300)) // let the takeover reach its first contested lock
        await tx.aiToolInvocation.updateMany({
          where: { id: invocation.id },
          data: { status: AiToolInvocationStatus.SKIPPED },
        })
        await tx.aiRun.updateMany({
          where: { id: run.id, status: AiRunStatus.QUEUED },
          data: { status: AiRunStatus.CANCELLED, terminalReasonCode: 'cancelled_by_user' },
        })
      })
      await runLocked.promise
      const takeover = control.takeControl(
        { userId: user.id, isSuperAdmin: false },
        conversation.id
      )
      takeoverStarted.resolve()

      const results = await Promise.allSettled([cancel, takeover])

      // Reversed order (invocation before run) would deadlock one of them (Prisma P2034 / 40P01).
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(after.status).toBe(AiRunStatus.CANCELLED)
      expect(
        (await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).status
      ).toBe(AiToolInvocationStatus.SKIPPED)
      expect(controls.toolCalls).toHaveLength(0)
    })

    it('the real cancel endpoint and a takeover racing on one queued run both finish, in either order', async () => {
      for (let round = 0; round < 8; round += 1) {
        const { user, conversation, run } = await queue()
        await approvedSensitiveInvocation(run.id, conversation.id, user.id)

        const results = await Promise.allSettled([
          runService.cancel(user.id, run.id),
          control.takeControl({ userId: user.id, isSuperAdmin: false }, conversation.id),
        ])

        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
        const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
        expect(after.status).toBe(AiRunStatus.CANCELLED)
      }
    })
  })
})
