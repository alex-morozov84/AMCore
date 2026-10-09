import { AiApprovalService } from '../../src/core/ai/approvals/ai-approval.service'
import { AiRunStepType } from '../../src/generated/prisma/client'
import { AiQueuedRestrictionDiagnosis } from '../../src/infrastructure/ai/runs/ai-queued-restriction-diagnosis'
import { ShutdownLatch } from '../../src/infrastructure/worker-lifecycle'
import type { E2ETestContext } from '../helpers'

import { consistencyRepository, queuedConsistencyRun } from './ai-consistency-context'
import { controls } from './ai-run-controls'

const restriction = {
  version: 1,
  kind: 'unknown_until',
  observedAt: '2026-10-07T00:00:00.000Z',
  reason: 'overflow',
}
export function diagnosisHistoryProof(getContext: () => E2ETestContext): void {
  const sweep = (context: E2ETestContext): AiQueuedRestrictionDiagnosis =>
    new AiQueuedRestrictionDiagnosis(
      context.prisma,
      new ShutdownLatch({ warn: () => undefined }, 'history-fixture')
    )
  it('diagnosis preserves full/capped history, closes invocation classes and leaves approval evidence inert', async () => {
    const context = getContext()
    const { run, conversation, user } = await queuedConsistencyRun(context, {
      deadlineAt: null,
      leaseEpoch: 128,
      providerRetryRestriction: restriction,
    })
    await context.prisma.aiRunAttempt.create({
      data: { runId: run.id, epoch: 128, startedAt: new Date(), ioStartedAt: new Date() },
    })
    await context.prisma.aiRunStep.create({
      data: {
        runId: run.id,
        stepNumber: 2147483647,
        type: AiRunStepType.PROVIDER_CALL,
        detail: { sentinel: 'existing-history' },
      },
    })
    const approval = await context.prisma.aiApproval.create({
      data: {
        runId: run.id,
        conversationId: conversation.id,
        kind: 'TOOL_INVOCATION',
        state: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    const specifications = [
      ['EXECUTING', 'idempotent', 'OUTCOME_UNKNOWN'],
      ['EXECUTING', 'read_only', 'FAILED'],
      ['REQUESTED', 'idempotent', 'SKIPPED'],
      ['APPROVED', 'idempotent', 'SKIPPED'],
      ['AWAITING_APPROVAL', 'idempotent', 'AWAITING_APPROVAL'],
      ['SUCCEEDED', 'idempotent', 'SUCCEEDED'],
      ['OUTCOME_UNKNOWN', 'idempotent', 'OUTCOME_UNKNOWN'],
    ] as const
    for (const [status, idempotency] of specifications)
      await context.prisma.aiToolInvocation.create({
        data: {
          runId: run.id,
          toolId: `fixture_${status.toLowerCase()}_${idempotency}`,
          status,
          idempotency,
          executionEpoch: 128,
          riskClass: 'SAFE',
          approvalId: status === 'AWAITING_APPROVAL' ? approval.id : null,
        },
      })
    expect(await sweep(context).sweep()).toBe(1)
    const invocations = await context.prisma.aiToolInvocation.findMany({ where: { runId: run.id } })
    for (const [status, idempotency, outcome] of specifications)
      expect(
        invocations.find((row) => row.toolId === `fixture_${status.toLowerCase()}_${idempotency}`)
          ?.status
      ).toBe(outcome)
    const history = await context.prisma.aiRunAttempt.findMany({ where: { runId: run.id } })
    expect(history).toHaveLength(1)
    expect(history[0]!.endedAt).not.toBeNull()
    expect(await context.prisma.aiRunStep.count({ where: { runId: run.id } })).toBe(1)
    expect(
      (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }))
        .providerRetryRestriction
    ).toEqual(restriction)
    await expect(
      context.app.get(AiApprovalService).decide(user.id, approval.id, {
        decision: 'approve',
        intentHash: approval.intentHash ?? '0'.repeat(64),
      })
    ).rejects.toThrow()
    expect(
      (await context.prisma.aiApproval.findUniqueOrThrow({ where: { id: approval.id } })).state
    ).toBe('PENDING')
    expect(await consistencyRepository(context).claimDueBatch()).toHaveLength(0)
    expect(controls.providerCalls).toBe(0)
    expect(controls.effects).toHaveLength(0)
  })

  it('21 anomalous rows prove batch20, pass rate and overlap bound without history eviction', async () => {
    const context = getContext()
    for (let i = 0; i < 21; i++)
      await queuedConsistencyRun(context, {
        deadlineAt: null,
        providerRetryRestriction: restriction,
      })
    const diagnosis = sweep(context)
    const results = await Promise.all([diagnosis.sweep(), diagnosis.sweep()])
    expect(results[0]).toBeGreaterThan(0)
    expect(results[0]).toBeLessThanOrEqual(20)
    expect(results[1]).toBe(0)
    expect(await diagnosis.sweep()).toBe(0)
    expect(await context.prisma.aiRun.count({ where: { status: 'QUEUED' } })).toBe(21 - results[0]!)
    expect(await context.prisma.aiRunAttempt.count()).toBe(0)
  })

  it('a locked conversation is skipped; a corrected restriction is reclassified under locks', async () => {
    const context = getContext()
    const { run, conversation } = await queuedConsistencyRun(context, {
      deadlineAt: null,
      providerRetryRestriction: restriction,
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let acquired!: () => void
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const lock = context.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ai.ai_conversations WHERE id=${conversation.id} FOR UPDATE`
        acquired()
        await held
      },
      { timeout: 5000 }
    )
    await locked
    try {
      expect(await sweep(context).sweep()).toBe(0)
    } finally {
      release()
      await lock
    }
    const correction = {
      version: 1,
      kind: 'until',
      observedAt: restriction.observedAt,
      notBefore: new Date(Date.now() + 60000).toISOString(),
      source: 'http_date',
    }
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: { providerRetryRestriction: correction },
    })
    expect(await sweep(context).sweep()).toBe(0)
    expect((await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'QUEUED'
    )
    expect(await consistencyRepository(context).claimDueBatch()).toHaveLength(0)
  })
}
