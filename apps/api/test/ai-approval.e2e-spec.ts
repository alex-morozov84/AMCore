import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { ConflictException } from '../src/common/exceptions'
import { AiApprovalService } from '../src/core/ai/approvals/ai-approval.service'
import { AiRunService } from '../src/core/ai/runs/ai-run.service'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AiApprovalExpiryService } from '../src/infrastructure/ai/runs/ai-approval-expiry.service'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AI_TOOLS } from '../src/infrastructure/ai/tools/ai-tool.types'
import { currentTimeTool } from '../src/infrastructure/ai/tools/reference/current-time.tool'
import type { PrismaService } from '../src/prisma'

import { demoSensitiveTool } from './fixtures/demo-sensitive.tool'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import {
  AiApprovalState,
  AiMessageRole,
  AiRunStatus,
  AiRunStepType,
  AiToolInvocationStatus,
} from '@/generated/prisma/client'

/**
 * Arc E.5b-3 — first end-to-end proof of the human-in-the-loop approval lifecycle over real Postgres +
 * the durable worker. A **test-only** SENSITIVE tool (`demo_sensitive`) is injected via an
 * `overrideProvider(AI_TOOLS)` (never in production DI); a **seeded disabled** assistant allowlists it,
 * and the key-less mock provider (`__mock_tool__:demo_sensitive`) drives the park→resume script. Every
 * scenario asserts the durable DB state (run status/reason, approval state, invocation status), not just
 * an HTTP/service return. Background crons + the wake consumer are stopped so each test drives the
 * dispatcher itself with no drain racing the assertions.
 */
describe('AI approval lifecycle (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let approvals: AiApprovalService
  let runService: AiRunService
  let expiry: AiApprovalExpiryService

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder.overrideProvider(AI_TOOLS).useValue([currentTimeTool, demoSensitiveTool])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    approvals = app.get(AiApprovalService, { strict: false })
    runService = app.get(AiRunService, { strict: false })
    expiry = app.get(AiApprovalExpiryService, { strict: false })
    const scheduler = app.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
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
    const email = `ai-approval-${Date.now()}-${seq}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
      select: { id: true },
    })
    return user.id
  }

  /** A conversation bound to a disabled demo assistant that allowlists the SENSITIVE test tool. */
  async function createBoundConversation(userId: string): Promise<string> {
    seq += 1
    const assistant = await prisma.aiAssistant.create({
      data: {
        slug: `demo-${Date.now()}-${seq}`,
        version: 1,
        displayName: 'Demo assistant',
        // Enabled so the Arc F.4 runtime gate lets it drive a run (the producer + executor now require it).
        enabled: true,
        modelSelection: { modelSlug: 'mock-default' },
        allowedModalities: ['text'],
        toolAllowlist: ['demo_sensitive'],
      },
      select: { id: true },
    })
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId, assistantId: assistant.id },
      select: { id: true },
    })
    return conv.id
  }

  interface Parked {
    userId: string
    runId: string
    approvalId: string
    invocationId: string
  }

  /** Queue a run that requests the SENSITIVE tool, drain once, and assert it parked. */
  async function park(): Promise<Parked> {
    const userId = await createUser()
    const conversationId = await createBoundConversation(userId)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: '__mock_tool__:demo_sensitive' }],
    })
    await dispatch.drainDueBatches()

    const parked = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(parked.status).toBe(AiRunStatus.WAITING_APPROVAL)
    expect(parked.leaseToken).toBeNull() // lease released on park
    const approval = await prisma.aiApproval.findFirstOrThrow({ where: { runId: run.id } })
    expect(approval.state).toBe(AiApprovalState.PENDING)
    const invocation = await prisma.aiToolInvocation.findFirstOrThrow({ where: { runId: run.id } })
    expect(invocation.status).toBe(AiToolInvocationStatus.AWAITING_APPROVAL)
    expect(invocation.toolId).toBe('demo_sensitive')
    return { userId, runId: run.id, approvalId: approval.id, invocationId: invocation.id }
  }

  it('park → approve → resume → COMPLETED, executing the approved tool once', async () => {
    const { userId, runId, approvalId, invocationId } = await park()

    await approvals.decide(userId, approvalId, { decision: 'approve' })
    const requeued = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    expect(requeued.status).toBe(AiRunStatus.QUEUED)
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: approvalId } })).state).toBe(
      AiApprovalState.APPROVED
    )
    expect(
      (await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocationId } })).status
    ).toBe(AiToolInvocationStatus.APPROVED)

    await dispatch.drainDueBatches()

    const done = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    expect(done.status).toBe(AiRunStatus.COMPLETED)
    expect(done.terminalReasonCode).toBeNull()
    const inv = await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocationId } })
    expect(inv.status).toBe(AiToolInvocationStatus.SUCCEEDED)
    expect((inv.resultSummary as { output: string }).output).toBe('demo-sensitive-executed')
    const assistant = await prisma.aiMessage.findFirst({
      where: { runId, role: AiMessageRole.ASSISTANT },
    })
    expect(assistant).not.toBeNull()
    // Two provider calls are ledgered: the one that requested the tool (at park) + the final answer.
    expect(await prisma.aiUsageLedger.count({ where: { runId } })).toBeGreaterThanOrEqual(2)
  })

  it('park → reject → resume → COMPLETED, never executing the tool', async () => {
    const { userId, runId, approvalId, invocationId } = await park()

    await approvals.decide(userId, approvalId, { decision: 'reject' })
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: approvalId } })).state).toBe(
      AiApprovalState.REJECTED
    )

    await dispatch.drainDueBatches()

    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      AiRunStatus.COMPLETED
    )
    // The invocation stays REJECTED (the tool never ran), but its applied TOOL_INVOCATION step exists.
    const inv = await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocationId } })
    expect(inv.status).toBe(AiToolInvocationStatus.REJECTED)
    expect(inv.resultSummary).toBeNull()
    const step = await prisma.aiRunStep.findFirst({
      where: { runId, type: AiRunStepType.TOOL_INVOCATION },
    })
    expect(step).not.toBeNull()
  })

  it('approval TTL expiry (deadline not reached) → FAILED approval_expired, invocation REJECTED', async () => {
    const { runId, approvalId, invocationId } = await park()
    await prisma.aiApproval.update({
      where: { id: approvalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    expect(await expiry.expireDue()).toBe(1)

    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    expect(run.status).toBe(AiRunStatus.FAILED)
    expect(run.terminalReasonCode).toBe('approval_expired')
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: approvalId } })).state).toBe(
      AiApprovalState.EXPIRED
    )
    expect(
      (await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocationId } })).status
    ).toBe(AiToolInvocationStatus.REJECTED)
  })

  it('run deadline expiry → EXPIRED deadline_exceeded, invocation SKIPPED', async () => {
    const { runId, approvalId, invocationId } = await park()
    await prisma.aiApproval.update({
      where: { id: approvalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await prisma.aiRun.update({
      where: { id: runId },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    })

    await expiry.expireDue()

    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    expect(run.status).toBe(AiRunStatus.EXPIRED)
    expect(run.terminalReasonCode).toBe('deadline_exceeded')
    expect(
      (await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocationId } })).status
    ).toBe(AiToolInvocationStatus.SKIPPED)
  })

  it('cancel-while-waiting → CANCELLED, approval EXPIRED, invocation SKIPPED', async () => {
    const { userId, runId, approvalId, invocationId } = await park()

    const result = await runService.cancel(userId, runId)
    expect(result.status).toBe('cancelled')

    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })
    expect(run.status).toBe(AiRunStatus.CANCELLED)
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: approvalId } })).state).toBe(
      AiApprovalState.EXPIRED
    )
    expect(
      (await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocationId } })).status
    ).toBe(AiToolInvocationStatus.SKIPPED)
  })

  it('approve-after-terminal is a 409 non-effect (does not resurrect a cancelled run)', async () => {
    const { userId, runId, approvalId } = await park()
    await runService.cancel(userId, runId)

    await expect(
      approvals.decide(userId, approvalId, { decision: 'approve' })
    ).rejects.toBeInstanceOf(ConflictException)

    // The run stays CANCELLED and never re-queues.
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      AiRunStatus.CANCELLED
    )
  })
})
