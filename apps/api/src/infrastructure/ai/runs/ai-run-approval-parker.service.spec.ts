import { AiToolRiskClass } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { AiTool } from '../tools/ai-tool.types'

import type { AiRunRepository } from './ai-run.repository'
import { AiRunApprovalParker } from './ai-run-approval-parker.service'
import type { ClaimedRun } from './ai-run-dispatch.types'
import type { RunPlan } from './ai-run-plan'

import type { AuditLogService } from '@/core/audit'
import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the Arc E.5 approval parker: one transaction records the provider call + ledger,
 * creates the PENDING approval + AWAITING_APPROVAL invocation, CAS-parks the run (releasing the lease),
 * and writes the mandatory `ai.approval.requested` audit IN-TX. A lost lease rolls the whole park back.
 */

const TTL_MS = 3_600_000

function claim(over: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    modelSnapshot: {},
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: null,
    ownershipGeneration: 0,
    leaseToken: 'lease-abc',
    ...over,
  }
}

const plan = {
  modelSlug: 'claude-default',
  attribution: { userId: 'u1', organizationId: null },
} as unknown as RunPlan

const result = {
  text: '',
  finishReason: 'tool_calls',
  toolCalls: [{ toolCallId: 'c1', toolName: 'danger', input: {} }],
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  modelSlug: 'claude-default',
  providerType: 'MOCK',
} as never

const dangerTool: AiTool = {
  toolId: 'danger',
  displayName: 'Danger',
  description: 'danger',
  parameters: z.object({}).strict(),
  riskClass: AiToolRiskClass.SENSITIVE,
  idempotency: 'idempotent',
  execute: jest.fn(),
}

describe('AiRunApprovalParker', () => {
  let prisma: DeepMockProxy<PrismaService>
  let repository: DeepMockProxy<AiRunRepository>
  let metrics: { incAiApproval: jest.Mock }
  let audit: { record: jest.Mock }
  let parker: AiRunApprovalParker
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaService>()
    prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    // The park fences the conversation first (ADR-049, Arc F); default to fresh, bot-owned, active.
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 0, controlledBy: 'BOT', state: 'ACTIVE' },
    ] as never)
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    prisma.aiApproval.create.mockResolvedValue({ id: 'appr-1' } as never)
    prisma.aiToolInvocation.create.mockResolvedValue({ id: 'inv-1' } as never)
    repository = mockDeep<AiRunRepository>()
    repository.parkForApproval.mockResolvedValue(true)
    metrics = { incAiApproval: jest.fn() }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    const env = { get: jest.fn(() => TTL_MS) } as unknown as EnvService
    parker = new AiRunApprovalParker(
      prisma,
      repository,
      env,
      audit as unknown as AuditLogService,
      metrics as unknown as MetricsService,
      logger as never
    )
  })

  it('records the call + ledger, opens the PENDING approval + AWAITING_APPROVAL invocation, and parks', async () => {
    const ok = await parker.park(claim(), plan, result, 5, dangerTool, {})

    expect(ok).toBe(true)
    expect(prisma.aiRunStep.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ type: 'PROVIDER_CALL' })],
      })
    )
    expect(prisma.aiUsageLedger.create).toHaveBeenCalledTimes(1)
    expect(prisma.aiApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          conversationId: 'conv-1',
          kind: 'TOOL_INVOCATION',
          state: 'PENDING',
        }),
      })
    )
    expect(prisma.aiToolInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'AWAITING_APPROVAL',
          toolId: 'danger',
          approvalId: 'appr-1',
          argsSnapshot: {},
        }),
      })
    )
    expect(repository.parkForApproval).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'run-1' })
    )
    expect(metrics.incAiApproval).toHaveBeenCalledWith('tool_invocation', 'pending')
  })

  it('writes the mandatory ai.approval.requested audit IN THE PARK TRANSACTION (content-free)', async () => {
    await parker.park(claim(), plan, result, 5, dangerTool, {})
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.approval.requested',
        targetType: 'AI_APPROVAL',
        targetId: 'appr-1',
        metadata: expect.objectContaining({
          toolId: 'danger',
          riskClass: 'sensitive',
          approvalId: 'appr-1',
          invocationId: 'inv-1',
          runId: 'run-1',
        }),
      }),
      { tx: prisma } // in-tx, not best-effort (A2-R1 #3)
    )
  })

  it('caps the approval expiry at the run deadline when the deadline is tighter than the TTL', async () => {
    const deadlineAt = new Date(Date.now() + 1000) // sooner than TTL_MS
    await parker.park(claim({ deadlineAt }), plan, result, 5, dangerTool, {})
    expect(prisma.aiApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: deadlineAt }) })
    )
  })

  it('rolls the whole park back and returns false when the park CAS loses the lease', async () => {
    repository.parkForApproval.mockResolvedValue(false)
    const ok = await parker.park(claim(), plan, result, 5, dangerTool, {})
    expect(ok).toBe(false)
    expect(metrics.incAiApproval).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ai.run.park_lease_lost' }),
      expect.any(String)
    )
  })

  it('abandons the run superseded (no approval) when a human took over before the park', async () => {
    // The fence read returns a moved generation → lockAndAssertBotOwnership throws inside the tx.
    prisma.$queryRaw.mockResolvedValue([
      { ownershipGeneration: 1, controlledBy: 'HUMAN', state: 'PAUSED_FOR_HUMAN' },
    ] as never)

    const ok = await parker.park(claim(), plan, result, 5, dangerTool, {})

    expect(ok).toBe(false)
    expect(prisma.aiApproval.create).not.toHaveBeenCalled()
    expect(prisma.aiToolInvocation.create).not.toHaveBeenCalled()
    expect(repository.finalizeSuperseded).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'run-1' })
    )
  })
})
