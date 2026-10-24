import { jest } from '@jest/globals'
import { SchedulerRegistry } from '@nestjs/schedule'
import { v7 as uuidv7 } from 'uuid'

import { aiMessageContentSchema, SystemRole, type WorkCommand } from '@amcore/shared'

import { AppException } from '../src/common/exceptions'
import { BackgroundCommandService } from '../src/core/admin/background-command-service'
import { AiWorkCleanup } from '../src/core/ai/control/ai-work-cleanup'
import { AiWorkControl } from '../src/core/ai/control/ai-work-control'
import { aiRunRevision, aiWorkDigest } from '../src/core/ai/control/ai-work-policy'
import { AiWorkReader } from '../src/core/ai/control/ai-work-reader'
import { AiWorkRetry } from '../src/core/ai/control/ai-work-retry'
import { AiConversationOperatorService } from '../src/core/ai/conversations/ai-conversation-operator.service'
import { AiRunService } from '../src/core/ai/runs/ai-run.service'
import { aiRunInputFingerprint } from '../src/core/ai/runs/ai-run-input-fingerprint'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { seedAiCatalog } from '../src/core/system-seed/seed-ai-catalog'
import {
  AI_PROVIDER_ADAPTERS,
  type AiProviderAdapter,
} from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { MockAiAdapter } from '../src/infrastructure/ai/gateway/providers/mock.adapter'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunRepository } from '../src/infrastructure/ai/runs/ai-run.repository'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import type { DurableTransactionContext } from '../src/infrastructure/background-work'

import { closeManagedWorker } from './fixtures/background-work/close-managed-worker'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

describe('AI run durable control (real PostgreSQL)', () => {
  let context: E2ETestContext
  let producer: AiRunProducerService
  let runs: AiRunService
  let claims: AiRunRepository
  let control: AiWorkControl
  let cleanup: AiWorkCleanup
  let reader: AiWorkReader
  let retry: AiWorkRetry
  let dispatch: AiRunDispatchService
  let commands: BackgroundCommandService
  let transcript: AiConversationOperatorService
  let serial = 0

  beforeAll(async () => {
    context = await setupE2ETest()
    const app = context.app
    producer = app.get(AiRunProducerService, { strict: false })
    runs = app.get(AiRunService, { strict: false })
    claims = app.get(AiRunRepository, { strict: false })
    control = app.get(AiWorkControl, { strict: false })
    cleanup = app.get(AiWorkCleanup, { strict: false })
    reader = app.get(AiWorkReader, { strict: false })
    retry = app.get(AiWorkRetry, { strict: false })
    dispatch = app.get(AiRunDispatchService, { strict: false })
    commands = app.get(BackgroundCommandService, { strict: false })
    transcript = app.get(AiConversationOperatorService, { strict: false })
    for (const job of app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      job.stop()
    await closeManagedWorker(app, 'ai-runs')
  }, 180000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    await context.prisma.aiRunControl.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: { paused: false, revision: 0 },
    })
    await seedAiCatalog(context.prisma)
    await context.app.get(AiModelRegistry, { strict: false }).invalidate()
  })

  async function fixture(key = 'fixture-key') {
    serial += 1
    const email = `ai-control-${serial}@example.test`
    const user = await context.prisma.user.create({
      data: {
        email,
        emailCanonical: email,
        passwordHash: 'x',
      },
    })
    const conversation = await context.prisma.aiConversation.create({
      data: {
        ownerUserId: user.id,
      },
    })
    const input = {
      conversationId: conversation.id,
      inputParts: [{ type: 'text' as const, text: 'hello' }],
      idempotencyKey: key,
    }
    const run = await producer.create(user.id, input)
    return { user, conversation, run, input }
  }

  async function pause(): Promise<void> {
    const gate = await context.prisma.aiRunControl.findUniqueOrThrow({ where: { id: 1 } })
    const commandId = uuidv7()
    const command: WorkCommand = {
      contractVersion: 1,
      commandId,
      workId: 'ai-run-executions',
      operation: 'pause',
      targets: [],
      reason: 'Test maintenance',
      parameters: {},
      expectedWorkRevision: aiWorkDigest([gate.paused, gate.revision]),
    }
    await context.prisma.$transaction(async (tx) => {
      const ctx: DurableTransactionContext = {
        tx,
        now: new Date(),
        commandId,
        dispatchId: uuidv7(),
        dispatchNotAfter: new Date(Date.now() + 60000),
        principal: { type: 'jwt', sub: 'operator', sid: 'test', systemRole: SystemRole.SuperAdmin },
      }
      const locked = await control.lock(ctx, command)
      expect(control.eligibility(ctx, locked, command)).toBeNull()
      expect((await control.apply(ctx, locked, command)).get(command.workId)).toEqual({
        state: 'applied',
      })
    })
  }

  it('stops every new claim after pause and fails closed without the gate', async () => {
    const { run } = await fixture()
    const before = await reader.readSummary()
    expect(before.counts?.due.value).toBe(1)
    const page = await reader.list({ state: 'waiting', page: 1, limit: 25 })
    expect(page.rows[0]?.identity.id).toBe(run.id)
    await pause()
    expect(await claims.claimDueBatch(1)).toEqual([])
    expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'QUEUED'
    )
    await context.prisma.aiRunControl.delete({ where: { id: 1 } })
    await expect(claims.claimDueBatch(1)).rejects.toThrow('ai_run_claim_authority_missing')
  })

  it('separates completed and failed counts while retaining the terminal aggregate', async () => {
    const { run: completed } = await fixture()
    const { run: failed } = await fixture('failed-key')
    const finishedAt = new Date()
    await context.prisma.aiRun.update({
      where: { id: completed.id },
      data: { status: 'COMPLETED', finishedAt },
    })
    await context.prisma.aiRun.update({
      where: { id: failed.id },
      data: { status: 'FAILED', finishedAt },
    })
    const summary = await reader.readSummary()
    expect(summary.counts?.completed?.value).toBe(1)
    expect(summary.counts?.failed.value).toBe(1)
    expect(summary.counts?.terminal.value).toBe(2)
    expect((await reader.list({ state: 'completed', page: 1, limit: 25 })).rows).toHaveLength(1)
    expect((await reader.list({ state: 'failed', page: 1, limit: 25 })).rows).toHaveLength(1)
  })

  it('intersects the selected work state with native status, including delayed runs', async () => {
    const { run: failed } = await fixture()
    const { run: completed } = await fixture('completed-filter-key')
    const { run: delayed } = await fixture('delayed-filter-key')
    await context.prisma.aiRun.update({
      where: { id: failed.id },
      data: { status: 'FAILED', finishedAt: new Date() },
    })
    await context.prisma.aiRun.update({
      where: { id: completed.id },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    })
    await context.prisma.aiRun.update({
      where: { id: delayed.id },
      data: { availableAt: new Date(Date.now() + 60000) },
    })
    const query = { page: 1, limit: 25 }
    expect(
      (await reader.list({ ...query, state: 'failed', filters: { status: 'FAILED' } })).rows
    ).toHaveLength(1)
    expect(
      (await reader.list({ ...query, state: 'failed', filters: { status: 'COMPLETED' } })).rows
    ).toHaveLength(0)
    expect(
      (await reader.list({ ...query, state: 'delayed', filters: { status: 'QUEUED' } })).rows
    ).toHaveLength(1)
    expect(
      (await reader.list({ ...query, state: 'waiting', filters: { status: 'QUEUED' } })).rows
    ).toHaveLength(0)
  })

  it('makes two competing claims wait for a committing pause', async () => {
    await fixture()
    await fixture('another-key')
    let unlock!: () => void
    let gateLocked!: () => void
    const release = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const acquired = new Promise<void>((resolve) => {
      gateLocked = resolve
    })
    const pausing = context.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai.ai_run_control WHERE id = 1 FOR UPDATE`
      gateLocked()
      await release
      await tx.aiRunControl.update({ where: { id: 1 }, data: { paused: true } })
    })
    await acquired
    const first = claims.claimDueBatch(1)
    const second = claims.claimDueBatch(1)
    try {
      const until = Date.now() + 700
      let blocked = 0
      while (Date.now() < until && blocked < 2) {
        const [row] = await context.prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
            AND query LIKE '%ai_run_control%'`
        blocked = Number(row?.n ?? 0)
        if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(blocked).toBeGreaterThanOrEqual(2)
    } finally {
      unlock()
    }
    await pausing
    expect(await Promise.all([first, second])).toEqual([[], []])
    expect(await context.prisma.aiRunAttempt.count()).toBe(0)
  })

  it('commits a privileged pause with the common receipt and audit', async () => {
    const { user } = await fixture()
    await context.prisma.user.update({
      where: { id: user.id },
      data: { systemRole: 'SUPER_ADMIN' },
    })
    const session = await context.prisma.session.create({
      data: {
        userId: user.id,
        familyId: uuidv7(),
        refreshToken: uuidv7(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    const gate = await context.prisma.aiRunControl.findUniqueOrThrow({ where: { id: 1 } })
    const receipt = await commands.executeDurable(
      {
        type: 'jwt',
        sub: user.id,
        sid: session.id,
        systemRole: SystemRole.SuperAdmin,
      },
      {
        contractVersion: 1,
        commandId: uuidv7(),
        workId: 'ai-run-executions',
        operation: 'pause',
        reason: 'Test maintenance',
        targets: [],
        parameters: {},
        expectedWorkRevision: aiWorkDigest([gate.paused, gate.revision]),
      },
      1,
      control
    )
    expect(receipt.state).toBe('applied')
    expect((await context.prisma.aiRunControl.findUniqueOrThrow({ where: { id: 1 } })).paused).toBe(
      true
    )
    expect(
      await context.prisma.auditLog.count({
        where: { actorId: user.id, targetId: 'ai-run-executions' },
      })
    ).toBeGreaterThan(0)
  })

  it('archives only an old never-started cancellation and preserves replay identity', async () => {
    const { user, conversation, run, input } = await fixture()
    await runs.cancel(user.id, run.id)
    expect((await producer.create(user.id, input)).id).toBe(run.id)
    const old = new Date(Date.now() - 31 * 86400000)
    await context.prisma.aiRun.update({ where: { id: run.id }, data: { finishedAt: old } })
    const source = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    const commandId = uuidv7()
    await context.prisma.$transaction(async (tx) => {
      expect(await cleanup.check(tx, source, new Date(), commandId)).toBeNull()
      await cleanup.remove(tx, source, user.id, commandId, new Date())
    })
    expect(await context.prisma.aiRun.findUnique({ where: { id: run.id } })).toBeNull()
    const message = await context.prisma.aiMessage.findUniqueOrThrow({
      where: { id: source.inputMessageId! },
    })
    expect(message).toMatchObject({ runId: null, archivedRunId: run.id })
    await context.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { controlledBy: 'HUMAN', state: 'CLOSED' },
    })
    const archived = await producer.create(user.id, input).catch((error: unknown) => error)
    expect(archived).toBeInstanceOf(AppException)
    expect((archived as AppException).getStatus()).toBe(410)
    expect(archived).toMatchObject({
      errorCode: 'AI_RUN_ARCHIVED',
      details: {
        id: run.id,
        conversationId: conversation.id,
        terminalStatus: 'cancelled',
      },
    })
    await expect(
      producer.create(user.id, { ...input, inputParts: [{ type: 'text', text: 'different' }] })
    ).rejects.toMatchObject({
      errorCode: 'AI_RUN_IDEMPOTENCY_CONFLICT',
    })
    await expect(runs.getOwned(user.id, run.id)).rejects.toMatchObject({
      errorCode: 'AI_RUN_ARCHIVED',
    })
    await expect(runs.getOwned('someone-else', run.id)).rejects.toMatchObject({
      errorCode: 'RESOURCE_NOT_FOUND',
    })
    const messages = await transcript.getTranscript(
      { type: 'jwt', sub: user.id, sid: user.id, systemRole: SystemRole.User },
      conversation.id,
      { limit: 20 }
    )
    expect(messages.data[0]).toMatchObject({
      originRunId: run.id,
      originArchived: true,
      operatorRetryOfRunId: null,
    })
  })

  it('expires an unclaimed run without an attempt, then permits only aged cleanup', async () => {
    const { run } = await fixture()
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    })
    expect(await claims.expireDeadlinedRuns()).toBe(1)
    const expired = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(expired).toMatchObject({ status: 'EXPIRED', leaseEpoch: 0, attemptCount: 0 })
    expect(await cleanup.check(context.prisma, expired, new Date())).toBe('COOLDOWN')
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(Date.now() - 31 * 86400000) },
    })
    const aged = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(await cleanup.check(context.prisma, aged, new Date())).toBeNull()
  })

  it('archives through the common command with receipt and strict audit', async () => {
    const { user, run } = await fixture()
    await context.prisma.user.update({
      where: { id: user.id },
      data: { systemRole: 'SUPER_ADMIN' },
    })
    const session = await context.prisma.session.create({
      data: {
        userId: user.id,
        familyId: uuidv7(),
        refreshToken: uuidv7(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    await runs.cancel(user.id, run.id)
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(Date.now() - 31 * 86400000) },
    })
    const source = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    const receipt = await commands.executeDurable(
      {
        type: 'jwt',
        sub: user.id,
        sid: session.id,
        systemRole: SystemRole.SuperAdmin,
      },
      {
        contractVersion: 1,
        commandId: uuidv7(),
        workId: 'ai-run-executions',
        operation: 'cleanup',
        reason: 'Retention policy',
        targets: [
          { id: source.id, incarnation: source.incarnation, revision: aiRunRevision(source) },
        ],
        expectedWorkRevision: 'a'.repeat(64),
        parameters: {
          states: ['completed'],
          cutoff: new Date(Date.now() - 30 * 86400000).toISOString(),
        },
      },
      1,
      control
    )
    expect(receipt.state).toBe('applied')
    expect(await context.prisma.aiRun.findUnique({ where: { id: run.id } })).toBeNull()
    expect(await context.prisma.aiRunTombstone.findUnique({ where: { id: run.id } })).toBeTruthy()
    expect(
      await context.prisma.auditLog.count({
        where: { actorId: user.id, targetId: 'ai-run-executions' },
      })
    ).toBeGreaterThan(0)
  })

  it('refuses cleanup after any execution attempt', async () => {
    const { user, run } = await fixture()
    const [claim] = await claims.claimDueBatch(1)
    expect(claim?.id).toBe(run.id)
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(Date.now() - 31 * 86400000),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    const source = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(aiRunRevision(source)).toMatch(/^[a-f0-9]{64}$/)
    expect(await cleanup.check(context.prisma, source, new Date())).toBe('RELATED_JOB')
    expect(await runs.getOwned(user.id, run.id)).toMatchObject({ status: 'cancelled' })
  })

  it('removes a linked source and child when the owner is deleted', async () => {
    const { user, run } = await fixture()
    const source = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    await context.prisma.aiRun.create({
      data: {
        conversationId: source.conversationId,
        retryOfRunId: source.id,
        inputMessageId: source.inputMessageId,
        inputFingerprint: source.inputFingerprint,
        assistantBindingCaptured: true,
        modelSnapshot: source.modelSnapshot as object,
      },
    })
    await context.prisma.user.delete({ where: { id: user.id } })
    expect(
      await context.prisma.aiRun.count({ where: { conversationId: source.conversationId } })
    ).toBe(0)
  })

  it('creates one linked text child with its own deadline and executes its source input', async () => {
    const { user, run } = await fixture()
    const adapters = context.app.get<AiProviderAdapter[]>(AI_PROVIDER_ADAPTERS, { strict: false })
    const mock = adapters.find((adapter) => adapter instanceof MockAiAdapter) as MockAiAdapter
    const failure = jest.spyOn(mock, 'generateText').mockRejectedValue(new Error('transient'))
    try {
      const budget = (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }))
        .maxAttempts
      for (let attempt = 1; attempt <= budget; attempt += 1) {
        await dispatch.drainDueBatches()
        if (attempt < budget)
          await context.prisma.aiRun.update({
            where: { id: run.id },
            data: { nextAttemptAt: new Date(Date.now() - 1000) },
          })
      }
    } finally {
      failure.mockRestore()
    }
    const source = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(source).toMatchObject({
      status: 'FAILED',
      terminalReasonCode: 'attempts_exhausted',
      errorCode: 'provider_unavailable',
      attemptCount: source.maxAttempts - 1,
    })
    expect(await context.prisma.aiRunAttempt.count({ where: { runId: source.id } })).toBe(
      source.maxAttempts
    )
    expect({
      tools: await context.prisma.aiToolInvocation.count({ where: { runId: source.id } }),
      approvals: await context.prisma.aiApproval.count({ where: { runId: source.id } }),
      steps: await context.prisma.aiRunStep.findMany({
        where: { runId: source.id },
        select: { type: true },
      }),
      output: await context.prisma.aiMessage.count({
        where: { runId: source.id, role: 'ASSISTANT' },
      }),
    }).toEqual({
      tools: 0,
      approvals: 0,
      steps: Array.from({ length: source.maxAttempts }, () => ({ type: 'FINALIZATION' })),
      output: 0,
    })
    const commandId = uuidv7()
    const command: WorkCommand = {
      contractVersion: 1,
      commandId,
      workId: 'ai-run-executions',
      operation: 'retry',
      targets: [
        { id: source.id, incarnation: source.incarnation, revision: aiRunRevision(source) },
      ],
      expectedWorkRevision: 'a'.repeat(64),
      reason: 'Transient provider outage',
      parameters: {},
    }
    const registry = context.app.get(AiModelRegistry, { strict: false })
    const cached = jest.spyOn(registry, 'resolveModel').mockRejectedValue(new Error('cache used'))
    const separate = jest
      .spyOn(registry, 'resolveLiveModel')
      .mockRejectedValue(new Error('pool used'))
    let result
    try {
      result = await context.prisma.$transaction(async (tx) => {
        const ctx: DurableTransactionContext = {
          tx,
          now: new Date(),
          commandId,
          dispatchId: uuidv7(),
          dispatchNotAfter: new Date(Date.now() + 60000),
          principal: { type: 'jwt', sub: user.id, sid: 'test', systemRole: SystemRole.SuperAdmin },
        }
        const locked = await control.lock(ctx, command)
        return (await control.apply(ctx, locked, command)).get(source.id)
      })
      expect(cached).not.toHaveBeenCalled()
      expect(separate).not.toHaveBeenCalled()
    } finally {
      cached.mockRestore()
      separate.mockRestore()
    }
    expect(result).toEqual({ state: 'applied' })
    const child = await context.prisma.aiRun.findFirstOrThrow({
      where: { retryOfRunId: source.id },
    })
    expect(child).toMatchObject({
      inputMessageId: source.inputMessageId,
      maxAttempts: 1,
      assistantBindingCaptured: true,
    })
    expect(child.deadlineAt!.getTime()).toBeGreaterThan(source.deadlineAt!.getTime())
    expect(await runs.getOwned(user.id, source.id)).toMatchObject({
      retriedByRunId: child.id,
    })
    await dispatch.drainDueBatches()
    expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: child.id } })).status).toBe(
      'COMPLETED'
    )
    expect(
      await context.prisma.aiMessage.count({
        where: {
          runId: child.id,
          role: 'USER',
        },
      })
    ).toBe(0)
    const messages = await transcript.getTranscript(
      { type: 'jwt', sub: user.id, sid: user.id, systemRole: SystemRole.User },
      source.conversationId,
      { limit: 20 }
    )
    expect(messages.data.find((message) => message.runId === child.id)).toMatchObject({
      originRunId: child.id,
      originArchived: false,
      operatorRetryOfRunId: source.id,
    })
  })

  it('keeps the legacy queued input lookup but refuses a damaged new link', async () => {
    const legacy = await fixture('legacy-key')
    const damaged = await fixture('new-key')
    await context.prisma.aiRun.update({
      where: { id: legacy.run.id },
      data: {
        assistantBindingCaptured: false,
        inputMessageId: null,
      },
    })
    await context.prisma.aiRun.update({
      where: { id: damaged.run.id },
      data: {
        inputMessageId: null,
      },
    })
    await dispatch.drainDueBatches()
    expect(
      (
        await context.prisma.aiRun.findUniqueOrThrow({
          where: { id: legacy.run.id },
        })
      ).status
    ).toBe('COMPLETED')
    expect(
      await context.prisma.aiRun.findUniqueOrThrow({
        where: { id: damaged.run.id },
      })
    ).toMatchObject({ status: 'FAILED', errorCode: 'input_missing' })
  })

  it('refuses artifacts and any prior tool effect in transient retry history', async () => {
    const { run } = await fixture()
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        terminalReasonCode: 'attempts_exhausted',
        errorCode: 'provider_timeout',
        attemptCount: 0,
        maxAttempts: 1,
        leaseEpoch: 1,
      },
    })
    await context.prisma.aiRunAttempt.create({
      data: {
        runId: run.id,
        epoch: 1,
        outcome: 'FAILED',
        errorCode: 'provider_timeout',
        endedAt: new Date(),
      },
    })
    const input = await context.prisma.aiMessage.findFirstOrThrow({
      where: { runId: run.id, role: 'USER' },
    })
    const withFile = [{ type: 'artifact_ref' as const, artifactId: 'artifact-1' }]
    await context.prisma.aiMessage.update({ where: { id: input.id }, data: { content: withFile } })
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: { inputFingerprint: aiRunInputFingerprint(withFile) },
    })
    const source = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(await retry.check(context.prisma, source, new Date())).toEqual({
      reason: 'CONTENT_UNSUPPORTED',
    })
    await context.prisma.aiMessage.update({
      where: { id: input.id },
      data: { content: input.content as object },
    })
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: {
        inputFingerprint: aiRunInputFingerprint(aiMessageContentSchema.parse(input.content)),
      },
    })
    await context.prisma.aiToolInvocation.create({
      data: {
        runId: run.id,
        toolId: 'fixture-tool',
        status: 'OUTCOME_UNKNOWN',
      },
    })
    const restored = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(await retry.check(context.prisma, restored, new Date())).toEqual({
      reason: 'EFFECT_UNKNOWN',
    })
  })
})
