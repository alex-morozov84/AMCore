import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import {
  AiApprovalState,
  AiConversationControl,
  AiConversationState,
  AiMessageRole,
  AiRunStatus,
  AiRunStepType,
  AiToolInvocationStatus,
} from '@prisma/client'
import request from 'supertest'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { ConflictException } from '../src/common/exceptions'
import { AiApprovalService } from '../src/core/ai/approvals/ai-approval.service'
import { AiConversationControlService } from '../src/core/ai/conversations/ai-conversation-control.service'
import { AiConversationOperatorService } from '../src/core/ai/conversations/ai-conversation-operator.service'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import { AI_TOOLS } from '../src/infrastructure/ai/tools/ai-tool.types'
import { currentTimeTool } from '../src/infrastructure/ai/tools/reference/current-time.tool'
import type { PrismaService } from '../src/prisma'

import { demoFenceTool, setDemoFenceHook } from './fixtures/demo-fence.tool'
import { demoSensitiveTool } from './fixtures/demo-sensitive.tool'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

/**
 * Arc F.5 — end-to-end proof of human takeover / operator review over real Postgres + the durable
 * worker. Background crons + the wake consumer are stopped so each test drives the dispatcher itself.
 * The key-less mock provider drives runs (`__mock_tool__:<tool>` requests a tool call). Every scenario
 * asserts durable DB state (run status/reason, conversation control/generation, approval/invocation
 * state, transcript), the takeover state machine, the worker generation fence, and content-free audit.
 */
describe('AI human takeover lifecycle (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let control: AiConversationControlService
  let operator: AiConversationOperatorService
  let approvals: AiApprovalService

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder
        .overrideProvider(AI_TOOLS)
        .useValue([currentTimeTool, demoSensitiveTool, demoFenceTool])
    )
    app = context.app
    prisma = context.prisma
    producer = app.get(AiRunProducerService, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    control = app.get(AiConversationControlService, { strict: false })
    operator = app.get(AiConversationOperatorService, { strict: false })
    approvals = app.get(AiApprovalService, { strict: false })
    const scheduler = app.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
    await app.get(AiRunDispatchProcessor, { strict: false }).worker.close()
  }, 120000)

  afterAll(async () => {
    setDemoFenceHook(null)
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    setDemoFenceHook(null)
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await seedSystemRoles(prisma)
    await seedAiCatalog(prisma)
  })

  let seq = 0
  async function createUser(): Promise<string> {
    seq += 1
    const email = `ai-takeover-${Date.now()}-${seq}@example.com`
    const user = await prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
      select: { id: true },
    })
    return user.id
  }

  function ownerPrincipal(userId: string): RequestPrincipal {
    return { type: 'jwt', sub: userId, email: 'o@e.com', systemRole: SystemRole.User, sid: userId }
  }
  function owner(userId: string): { userId: string; isSuperAdmin: boolean } {
    return { userId, isSuperAdmin: false }
  }

  async function createConversation(userId: string): Promise<string> {
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId },
      select: { id: true },
    })
    return conv.id
  }

  /** A conversation bound to an ENABLED assistant that allowlists the given tools, pinning `modelSlug`. */
  async function createBoundConversation(
    userId: string,
    tools: string[],
    modelSlug = 'mock-default'
  ): Promise<string> {
    seq += 1
    const assistant = await prisma.aiAssistant.create({
      data: {
        slug: `f5-${Date.now()}-${seq}`,
        version: 1,
        displayName: 'F5 assistant',
        enabled: true,
        modelSelection: { modelSlug },
        allowedModalities: ['text'],
        toolAllowlist: tools,
      },
      select: { id: true },
    })
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId, assistantId: assistant.id },
      select: { id: true },
    })
    return conv.id
  }

  /**
   * Seed a SECOND enabled mock model with a distinct slug (cloning the seed's `mock-default`
   * capabilities so the registry accepts it). Pinning it proves the run honors the assistant's
   * `modelSelection` rather than coincidentally matching the credential-gated default.
   */
  async function seedAltMockModel(slug: string): Promise<void> {
    const base = await prisma.aiModel.findFirstOrThrow({ where: { slug: 'mock-default' } })
    await prisma.aiModel.create({
      data: {
        providerId: base.providerId,
        slug,
        providerModelName: base.providerModelName,
        displayName: 'Mock alt',
        enabled: true,
        isDefault: false,
        capabilities: base.capabilities as never,
        contextLimit: base.contextLimit,
        maxOutputTokens: base.maxOutputTokens,
      },
    })
  }

  it('takeover supersedes a QUEUED bot run and writes no assistant turn', async () => {
    const userId = await createUser()
    const conversationId = await createConversation(userId)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: 'hello' }],
    })

    await control.takeControl(owner(userId), conversationId)

    const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe(AiRunStatus.CANCELLED)
    expect(after.terminalReasonCode).toBe('superseded_by_human')
    const conv = await prisma.aiConversation.findUniqueOrThrow({ where: { id: conversationId } })
    expect(conv.controlledBy).toBe(AiConversationControl.HUMAN)
    expect(conv.state).toBe(AiConversationState.PAUSED_FOR_HUMAN)
    expect(conv.ownershipGeneration).toBe(1)
    expect(conv.humanControlUserId).toBe(userId)
    // Only the USER input turn exists — no bot ASSISTANT turn was written.
    const assistantTurns = await prisma.aiMessage.count({
      where: { conversationId, role: AiMessageRole.ASSISTANT },
    })
    expect(assistantTurns).toBe(0)
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ai.conversation.taken_over', targetId: conversationId },
    })
    expect(audit).not.toBeNull()
  })

  it('takeover voids a WAITING_APPROVAL run: approval EXPIRED, invocation SKIPPED, run superseded', async () => {
    const userId = await createUser()
    const conversationId = await createBoundConversation(userId, ['demo_sensitive'])
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: '__mock_tool__:demo_sensitive' }],
    })
    await dispatch.drainDueBatches()
    const parked = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(parked.status).toBe(AiRunStatus.WAITING_APPROVAL)

    await control.takeControl(owner(userId), conversationId)

    const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe(AiRunStatus.CANCELLED)
    expect(after.terminalReasonCode).toBe('superseded_by_human')
    const approval = await prisma.aiApproval.findFirstOrThrow({ where: { runId: run.id } })
    expect(approval.state).toBe(AiApprovalState.EXPIRED)
    const invocation = await prisma.aiToolInvocation.findFirstOrThrow({ where: { runId: run.id } })
    expect(invocation.status).toBe(AiToolInvocationStatus.SKIPPED)
    // Per-approval void audit + the aggregate takeover audit both exist, content-free.
    const expired = await prisma.auditLog.findFirst({
      where: { action: 'ai.approval.expired', targetId: approval.id },
    })
    expect(expired?.metadata).toMatchObject({ reasonCode: 'superseded_by_human' })

    // A later owner approval decision on the voided approval is a 409 non-effect: the approval stays
    // EXPIRED, the run stays CANCELLED/superseded, and nothing re-queues or executes a tool.
    await expect(
      approvals.decide(userId, approval.id, { decision: 'approve' })
    ).rejects.toBeInstanceOf(ConflictException)
    const afterDecision = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(afterDecision.status).toBe(AiRunStatus.CANCELLED)
    expect(afterDecision.terminalReasonCode).toBe('superseded_by_human')
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: approval.id } })).state).toBe(
      AiApprovalState.EXPIRED
    )
    expect(
      (await prisma.aiToolInvocation.findUniqueOrThrow({ where: { id: invocation.id } })).status
    ).toBe(AiToolInvocationStatus.SKIPPED)
  })

  it('worker fence supersedes a stale-generation run at preflight (no provider call)', async () => {
    const userId = await createUser()
    const conversationId = await createConversation(userId)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: 'hello' }],
    })
    // Simulate a takeover that did NOT sweep this run (advance generation directly): the worker's own
    // preflight fence must catch the stale run when it drains.
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: {
        ownershipGeneration: 1,
        controlledBy: AiConversationControl.HUMAN,
        state: AiConversationState.PAUSED_FOR_HUMAN,
      },
    })

    await dispatch.drainDueBatches()

    const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe(AiRunStatus.CANCELLED)
    expect(after.terminalReasonCode).toBe('superseded_by_human')
    const assistantTurns = await prisma.aiMessage.count({
      where: { conversationId, role: AiMessageRole.ASSISTANT },
    })
    expect(assistantTurns).toBe(0)
  })

  it('takeover DURING tool execution leaves the invocation EXECUTING (orphan) with no tool step', async () => {
    const userId = await createUser()
    const conversationId = await createBoundConversation(userId, ['demo_fence'])
    // The SAFE tool lands a takeover mid-execution: the dispatcher's in-tx result fence then rolls back
    // the SUCCEEDED commit + TOOL_INVOCATION step, and the run is superseded — an EXECUTING orphan remains.
    setDemoFenceHook(async () => {
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: {
          ownershipGeneration: 1,
          controlledBy: AiConversationControl.HUMAN,
          state: AiConversationState.PAUSED_FOR_HUMAN,
        },
      })
    })
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: '__mock_tool__:demo_fence' }],
    })

    await dispatch.drainDueBatches()

    const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe(AiRunStatus.CANCELLED)
    expect(after.terminalReasonCode).toBe('superseded_by_human')
    // Intended contract: "no stale transcript/step/terminal", NOT invocation reconciliation — the tool
    // ran (at-least-once) so its invocation stays EXECUTING, but no SUCCEEDED result / TOOL_INVOCATION
    // step is committed and no assistant turn is written.
    const invocation = await prisma.aiToolInvocation.findFirstOrThrow({ where: { runId: run.id } })
    expect(invocation.status).toBe(AiToolInvocationStatus.EXECUTING)
    const toolSteps = await prisma.aiRunStep.count({
      where: { runId: run.id, type: AiRunStepType.TOOL_INVOCATION },
    })
    expect(toolSteps).toBe(0)
    const assistantTurns = await prisma.aiMessage.count({
      where: { conversationId, role: AiMessageRole.ASSISTANT },
    })
    expect(assistantTurns).toBe(0)
  })

  it('operator review: take control, read transcript, post a human turn, release', async () => {
    const userId = await createUser()
    const conversationId = await createConversation(userId)
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: 'hello there' }],
    })
    await dispatch.drainDueBatches()
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      AiRunStatus.COMPLETED
    )

    await control.takeControl(owner(userId), conversationId)

    const transcript = await operator.getTranscript(ownerPrincipal(userId), conversationId, {
      limit: 20,
    })
    expect(transcript.data.length).toBeGreaterThanOrEqual(2) // the user turn + the bot's completed turn

    const posted = await operator.postMessage(ownerPrincipal(userId), conversationId, {
      content: [{ type: 'text', text: 'operator correction' }],
    })
    const message = await prisma.aiMessage.findUniqueOrThrow({ where: { id: posted.id } })
    // The human occupies the assistant seat; the owner authors it as USER.
    expect(message.role).toBe(AiMessageRole.ASSISTANT)
    expect(message.authorType).toBe('USER')
    expect(message.authorUserId).toBe(userId)

    await control.releaseControl(owner(userId), conversationId)
    const conv = await prisma.aiConversation.findUniqueOrThrow({ where: { id: conversationId } })
    expect(conv.controlledBy).toBe(AiConversationControl.BOT)
    expect(conv.state).toBe(AiConversationState.ACTIVE)
    expect(conv.humanControlUserId).toBeNull()
    expect(conv.ownershipGeneration).toBe(2) // +1 take, +1 release
  })

  it('cannot post an operator message without holding control (409), and a run cannot be queued under human control (409)', async () => {
    const userId = await createUser()
    const conversationId = await createConversation(userId)

    // Not held → post is rejected.
    await expect(
      operator.postMessage(ownerPrincipal(userId), conversationId, {
        content: [{ type: 'text', text: 'no control' }],
      })
    ).rejects.toBeInstanceOf(ConflictException)

    // Under human control → the producer front-door gate rejects a new bot run.
    await control.takeControl(owner(userId), conversationId)
    await expect(
      producer.create(userId, { conversationId, inputParts: [{ type: 'text', text: 'hi' }] })
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('applies the bound assistant model at run creation; a disabled assistant fails the run (Arc F.4)', async () => {
    const userId = await createUser()
    // Pin a DISTINCT model (not the credential-gated default) to prove modelSelection is honored.
    await seedAltMockModel('mock-alt')
    const conversationId = await createBoundConversation(userId, [], 'mock-alt')
    const run = await producer.create(userId, {
      conversationId,
      inputParts: [{ type: 'text', text: 'hello' }],
    })
    const snapshot = (await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }))
      .modelSnapshot as { modelSlug?: string }
    expect(snapshot.modelSlug).toBe('mock-alt') // the assistant's pinned model, not the default

    // Disable the assistant AFTER the run was queued → the executor kill-switch fails it.
    await prisma.aiAssistant.updateMany({
      where: {
        id: (await prisma.aiConversation.findUniqueOrThrow({ where: { id: conversationId } }))
          .assistantId!,
      },
      data: { enabled: false },
    })
    await dispatch.drainDueBatches()
    const after = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe(AiRunStatus.FAILED)
    expect(after.errorCode).toBe('assistant_disabled')
  })

  describe('HTTP access matrix (bearer-only, cross-user step-up + reason)', () => {
    const server = () => app.getHttpServer()

    async function registerHttp(email: string): Promise<{ token: string; userId: string }> {
      const res = await request(server())
        .post('/auth/register')
        .send({ email, password: 'StrongP@ss123' })
        .expect(201)
      return { token: res.body.accessToken as string, userId: res.body.user.id as string }
    }

    /** Promote to SUPER_ADMIN and log back in for a FRESH token carrying the updated role. */
    async function promoteSuperAdmin(userId: string, email: string): Promise<string> {
      await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
      const res = await request(server())
        .post('/auth/login')
        .send({ email, password: 'StrongP@ss123' })
        .expect(200)
      return res.body.accessToken as string
    }

    it('rejects an API key on takeover (bearer-only → 401)', async () => {
      const { token, userId } = await registerHttp('apikey-user@example.com')
      const conversationId = await createConversation(userId)
      const org = await request(server())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Key Org' })
        .expect(201)
      const key = await request(server())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'k', organizationId: org.body.id, scopes: ['read:User'] })
        .expect(201)

      await request(server())
        .post(`/ai/conversations/${conversationId}/takeover`)
        .set('Authorization', `Bearer ${key.body.key}`)
        .send({ reason: 'SUP-1' })
        .expect(401)
    })

    it('cross-user SUPER_ADMIN with a STALE session → 403 STEP_UP_REQUIRED', async () => {
      const owner = await registerHttp('owner-a@example.com')
      const conversationId = await createConversation(owner.userId)
      const admin = await registerHttp('admin-a@example.com')
      const adminToken = await promoteSuperAdmin(admin.userId, 'admin-a@example.com')
      // Age the operator's session past the step-up window.
      await prisma.session.updateMany({
        where: { userId: admin.userId },
        data: { lastAuthAt: new Date(0) },
      })

      const res = await request(server())
        .post(`/ai/conversations/${conversationId}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'SUP-1' })
        .expect(403)
      expect(JSON.stringify(res.body)).toContain('STEP_UP_REQUIRED')

      // The conversation is untouched — no takeover happened.
      const conv = await prisma.aiConversation.findUniqueOrThrow({ where: { id: conversationId } })
      expect(conv.controlledBy).toBe(AiConversationControl.BOT)
    })

    it('cross-user SUPER_ADMIN (fresh) with NO reason → 400', async () => {
      const owner = await registerHttp('owner-b@example.com')
      const conversationId = await createConversation(owner.userId)
      const admin = await registerHttp('admin-b@example.com')
      const adminToken = await promoteSuperAdmin(admin.userId, 'admin-b@example.com')

      await request(server())
        .post(`/ai/conversations/${conversationId}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400)
    })

    it('cross-user transcript read (fresh + x-amcore-operator-reason header) is audited', async () => {
      const owner = await registerHttp('owner-c@example.com')
      const conversationId = await createConversation(owner.userId)
      const admin = await registerHttp('admin-c@example.com')
      const adminToken = await promoteSuperAdmin(admin.userId, 'admin-c@example.com')

      await request(server())
        .get(`/ai/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-amcore-operator-reason', 'SUP-9')
        .expect(200)

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'ai.conversation.transcript_accessed', targetId: conversationId },
      })
      expect(audit).not.toBeNull()
      expect(audit?.metadata).toMatchObject({ actorRole: 'operator', reasonRef: 'SUP-9' })
    })

    it('cross-user SUPER_ADMIN operator message is authored OPERATOR and audited content-free', async () => {
      const owner = await registerHttp('owner-d@example.com')
      const conversationId = await createConversation(owner.userId)
      const admin = await registerHttp('admin-d@example.com')
      const adminToken = await promoteSuperAdmin(admin.userId, 'admin-d@example.com')

      // Cross-user takeover (fresh session + reason), then post a human turn as the operator.
      await request(server())
        .post(`/ai/conversations/${conversationId}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'SUP-7' })
        .expect(200)

      const sentinel = 'operator-secret-reply-sentinel'
      const posted = await request(server())
        .post(`/ai/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: [{ type: 'text', text: sentinel }], reason: 'SUP-7' })
        .expect(201)

      // The human occupies the assistant seat; a cross-user operator authors it as OPERATOR.
      const message = await prisma.aiMessage.findUniqueOrThrow({ where: { id: posted.body.id } })
      expect(message.role).toBe(AiMessageRole.ASSISTANT)
      expect(message.authorType).toBe('OPERATOR')
      expect(message.authorUserId).toBe(admin.userId)

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'ai.conversation.operator_message', targetId: conversationId },
      })
      expect(audit).not.toBeNull()
      expect(audit?.metadata).toMatchObject({ authorType: 'operator', actorRole: 'operator' })
      // The operator message text NEVER reaches the audit metadata.
      expect(JSON.stringify(audit?.metadata)).not.toContain(sentinel)
    })
  })
})
