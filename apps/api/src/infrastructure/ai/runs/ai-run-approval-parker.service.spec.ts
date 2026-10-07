import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { AiTool } from '../tools/ai-tool.types'

import type { AiRunRepository } from './ai-run.repository'
import { AiRunApprovalParker } from './ai-run-approval-parker.service'
import type { ClaimedRun, StopCause } from './ai-run-dispatch.types'
import type { AiRunGuard } from './ai-run-guard.service'
import type { RunPlan } from './ai-run-plan'

import type { AuditLogService } from '@/core/audit'
import type { EnvService } from '@/env/env.service'
import type { Prisma } from '@/generated/prisma/client'
import { AiToolRiskClass } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the Arc E.5 approval parker: one GUARDED transaction records the provider call + ledger,
 * creates the PENDING approval + AWAITING_APPROVAL invocation (with its `originCall` action identity),
 * CAS-parks the run (releasing the lease), and writes the mandatory `ai.approval.requested` audit IN-TX.
 * A visible stop cause refuses the park (no orphan approval); a lost lease writes nothing.
 */

const TTL_MS = 3_600_000

function claim(over: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    modelSnapshot: {},
    epoch: 1,
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
  let tx: DeepMockProxy<PrismaService>
  let guard: { record: jest.Mock }
  let repository: DeepMockProxy<AiRunRepository>
  let metrics: { incAiApproval: jest.Mock }
  let audit: { record: jest.Mock }
  let parker: AiRunApprovalParker
  let stop: StopCause | null
  let guardKind: 'ok' | 'lease_lost' | 'cutoff'
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    stop = null
    guardKind = 'ok'
    tx = mockDeep<PrismaService>()
    tx.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    tx.aiRunStep.count.mockResolvedValue(0 as never) // no provider call recorded yet → ordinal 1 is free
    tx.aiToolInvocation.findFirst.mockResolvedValue(null as never)
    tx.aiApproval.create.mockResolvedValue({ id: 'appr-1' } as never)
    tx.aiToolInvocation.create.mockResolvedValue({ id: 'inv-1' } as never)
    // The guard (conversation → run locks, fresh-clock lease, stop causes) is proved in its own spec: here
    // it runs the callback inside "a guarded transaction" and reports the stop cause it was scripted with.
    guard = {
      record: jest.fn(
        async (_claim: ClaimedRun, fn: (t: Prisma.TransactionClient, c: object) => unknown) => {
          if (guardKind !== 'ok') return { kind: guardKind }
          return { kind: 'ok', value: await fn(tx as never, { stop, epoch: 1 }), stop }
        }
      ),
    }
    repository = mockDeep<AiRunRepository>()
    repository.parkForApproval.mockResolvedValue(true)
    repository.finalizeCancelled.mockResolvedValue(true)
    repository.finalizeSuperseded.mockResolvedValue(true)
    repository.finalizeExpired.mockResolvedValue(true)
    metrics = { incAiApproval: jest.fn() }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    const env = { get: jest.fn(() => TTL_MS) } as unknown as EnvService
    parker = new AiRunApprovalParker(
      guard as unknown as AiRunGuard,
      repository,
      env,
      audit as unknown as AuditLogService,
      metrics as unknown as MetricsService,
      logger as never
    )
  })

  const park = (over: Partial<ClaimedRun> = {}) =>
    parker.park(claim(over), plan, result, 5, 1, dangerTool, {})

  it('records the call + ledger, opens the PENDING approval + AWAITING_APPROVAL invocation, and parks', async () => {
    const outcome = await park()

    expect(outcome).toBe('parked')
    expect(tx.aiRunStep.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ type: 'PROVIDER_CALL' })],
      })
    )
    expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
    expect(tx.aiApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-1',
          conversationId: 'conv-1',
          kind: 'TOOL_INVOCATION',
          state: 'PENDING',
        }),
      })
    )
    expect(tx.aiToolInvocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'AWAITING_APPROVAL',
          toolId: 'danger',
          approvalId: 'appr-1',
          argsSnapshot: {},
          // One requested action = one invocation: the provider-call ordinal is its durable identity.
          originCall: 1,
          idempotency: 'idempotent',
        }),
      })
    )
    expect(repository.parkForApproval).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 'run-1' })
    )
    expect(metrics.incAiApproval).toHaveBeenCalledWith('tool_invocation', 'pending')
  })

  it('writes the mandatory ai.approval.requested audit IN THE PARK TRANSACTION (content-free)', async () => {
    await park()
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
      { tx } // in-tx, not best-effort (A2-R1 #3)
    )
  })

  it('caps the approval expiry at the run deadline when the deadline is tighter than the TTL', async () => {
    const deadlineAt = new Date(Date.now() + 1000) // sooner than TTL_MS
    await park({ deadlineAt })
    expect(tx.aiApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: deadlineAt }) })
    )
  })

  describe('a visible stop cause refuses the park', () => {
    it.each([
      ['cancelled', 'finalizeCancelled'],
      ['superseded', 'finalizeSuperseded'],
      ['expired', 'finalizeExpired'],
    ] as const)(
      '%s: records the call + usage, terminalizes, and leaves NO pending approval or invocation',
      async (cause, finalizer) => {
        stop = cause

        const outcome = await park()

        expect(outcome).toBe('terminal')
        expect(tx.aiRunStep.createMany).toHaveBeenCalled() // the provider call happened: its spend is kept
        expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
        expect(repository[finalizer]).toHaveBeenCalled()
        expect(tx.aiApproval.create).not.toHaveBeenCalled()
        expect(tx.aiToolInvocation.create).not.toHaveBeenCalled()
        expect(repository.parkForApproval).not.toHaveBeenCalled()
        expect(metrics.incAiApproval).not.toHaveBeenCalled()
      }
    )
  })

  describe('one requested action = one gate', () => {
    it('is a no-op when an invocation already exists for this provider-call ordinal', async () => {
      tx.aiToolInvocation.findFirst.mockResolvedValue({ id: 'inv-existing' } as never)

      expect(await park()).toBe('exit')
      expect(tx.aiApproval.create).not.toHaveBeenCalled()
      expect(tx.aiRunStep.createMany).not.toHaveBeenCalled()
    })

    it('is a no-op when the ordinal was already taken by a recorded provider call', async () => {
      tx.aiRunStep.count.mockResolvedValue(1 as never)

      expect(await park()).toBe('exit')
      expect(tx.aiApproval.create).not.toHaveBeenCalled()
    })
  })

  describe('nothing is written when the guard refuses', () => {
    it.each(['lease_lost', 'cutoff'] as const)(
      '%s → exit, no approval, no metric',
      async (kind) => {
        guardKind = kind

        expect(await park()).toBe('exit')
        expect(tx.aiApproval.create).not.toHaveBeenCalled()
        expect(metrics.incAiApproval).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: 'ai.run.park_not_committed', kind }),
          expect.any(String)
        )
      }
    )
  })

  it('rolls the whole park back when the park CAS loses the lease (the guard reports it lost)', async () => {
    repository.parkForApproval.mockResolvedValue(false)
    guard.record.mockImplementation(
      async (_c: ClaimedRun, fn: (t: unknown, c: object) => unknown) => {
        try {
          return { kind: 'ok', value: await fn(tx, { stop: null, epoch: 1 }), stop: null }
        } catch (error) {
          if ((error as Error).name === 'RunLeaseLostError') return { kind: 'lease_lost' }
          throw error
        }
      }
    )

    expect(await park()).toBe('exit')
    expect(metrics.incAiApproval).not.toHaveBeenCalled()
  })
})
