import { AiRunStepType } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import {
  AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION,
  AI_RUN_GUARDRAIL_REFUSAL_MESSAGE,
  AiRunTerminalReason,
} from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, GuardrailRefusalInput } from './ai-run-dispatch.types'

import type { PrismaService } from '@/prisma'

function claim(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    modelSnapshot: { modelSlug: 'claude-default' },
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: null,
    leaseToken: 'lease-abc',
    ...overrides,
  }
}

describe('AiRunRepository', () => {
  let prisma: DeepMockProxy<PrismaService>
  let repo: AiRunRepository

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    repo = new AiRunRepository(prisma)
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
  })

  describe('claimDueBatch', () => {
    it('maps claimed rows to ClaimedRun with the post-increment attempt and a lease token', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'run-1',
          conversationId: 'conv-1',
          modelSnapshot: { modelSlug: 'claude-default' },
          attemptCount: 1,
          maxAttempts: 3,
          deadlineAt: null,
        },
      ] as never)

      const [run] = await repo.claimDueBatch()

      expect(run).toMatchObject({ id: 'run-1', attemptNumber: 1, maxAttempts: 3 })
      expect(run?.leaseToken).toEqual(expect.any(String))
    })
  })

  describe('finalizers (CAS)', () => {
    it('finalizeCompleted wins when the CAS matches the lease', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      await expect(repo.finalizeCompleted(prisma, claim())).resolves.toBe(true)
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', status: 'RUNNING', leaseToken: 'lease-abc' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            errorCode: null,
            terminalReasonCode: null,
            leaseToken: null,
          }),
        })
      )
    })

    it('a finalizer returns false (lease lost) when the CAS matches no row', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
      await expect(repo.finalizeFailed(prisma, claim(), 'provider_rejected')).resolves.toBe(false)
    })

    it('finalizeCancelled records the provided reason', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      await repo.finalizeCancelled(prisma, claim(), 'cancelled_by_user')
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            errorCode: null,
            terminalReasonCode: 'cancelled_by_user',
          }),
        })
      )
    })
  })

  describe('finalizeRefusal (Arc D guardrail block)', () => {
    function refusal(over: Partial<GuardrailRefusalInput> = {}): GuardrailRefusalInput {
      return {
        reasonCode: AiRunTerminalReason.GUARDRAIL_INPUT_BLOCKED,
        checkStepType: AiRunStepType.GUARDRAIL_CHECK,
        categories: [{ category: 'envelope_marker_abuse', count: 1 }],
        ...over,
      }
    }

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'conv-1' }] as never)
      prisma.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: 0 } } as never)
      prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
      prisma.aiMessage.create.mockResolvedValue({} as never)
      prisma.aiRunStep.createMany.mockResolvedValue({ count: 2 } as never)
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
    })

    it('CAS win → terminal FAILED (non-retryable) with the guardrail terminalReasonCode', async () => {
      await expect(repo.finalizeRefusal(claim(), refusal())).resolves.toBe(true)
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', status: 'RUNNING', leaseToken: 'lease-abc' },
          data: expect.objectContaining({
            status: 'FAILED',
            errorCode: 'guardrail_blocked',
            terminalReasonCode: 'guardrail_input_blocked',
            leaseToken: null,
            leaseExpiresAt: null,
          }),
        })
      )
      // Terminal, never re-queued: no QUEUED transition and no nextAttemptAt is scheduled.
      expect(prisma.aiRun.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) })
      )
    })

    it('persists a canned, content-free refusal turn as ASSISTANT / authorType SYSTEM', async () => {
      await repo.finalizeRefusal(claim(), refusal())
      expect(prisma.aiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: 'run-1',
            role: 'ASSISTANT',
            authorType: 'SYSTEM',
            content: [{ type: 'text', text: AI_RUN_GUARDRAIL_REFUSAL_MESSAGE }],
            redactionMeta: { classification: AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION },
          }),
        })
      )
    })

    it('writes a content-free check step (bounded categories) + a REFUSAL step', async () => {
      await repo.finalizeRefusal(claim(), refusal())
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { type: string; detail?: unknown; errorCode?: string }[] },
      ]
      expect(data.map((s) => s.type)).toEqual(['GUARDRAIL_CHECK', 'REFUSAL'])
      expect(data[0]!.detail).toEqual({
        categories: [{ category: 'envelope_marker_abuse', count: 1 }],
      })
      expect(data[1]!.errorCode).toBe('guardrail_input_blocked')
      // No prompt/output/marker/snippet ever rides the step detail.
      expect(JSON.stringify(data)).not.toContain('amcore:user-data-')
    })

    it('locks the conversation FOR UPDATE before allocating the refusal sequence', async () => {
      await repo.finalizeRefusal(claim(), refusal())
      const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0]
      const seqOrder = prisma.aiMessage.aggregate.mock.invocationCallOrder[0]
      expect(lockOrder).toBeLessThan(seqOrder as number)
    })

    it('omits step detail when no categories are supplied', async () => {
      await repo.finalizeRefusal(claim(), refusal({ categories: [] }))
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { detail?: unknown }[] },
      ]
      expect(data[0]!.detail).toBeUndefined()
    })

    it('defensively drops malicious/invalid categories (marker, snippet, bad count) from detail', async () => {
      await repo.finalizeRefusal(
        claim(),
        refusal({
          categories: [
            { category: 'amcore:user-data-abc123', count: 1 }, // marker value -> invalid grammar
            { category: 'ignore all previous instructions', count: 1 }, // snippet -> spaces invalid
            { category: 'ENVELOPE_MARKER_ABUSE', count: 1 }, // uppercase -> invalid
            { category: 'instruction_override', count: 0 }, // non-positive count -> dropped
            { category: 'system_prompt_probe', count: 2 }, // valid -> survives
          ],
        })
      )
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { detail?: unknown }[] },
      ]
      expect(data[0]!.detail).toEqual({
        categories: [{ category: 'system_prompt_probe', count: 2 }],
      })
      // The marker value and the prompt snippet never reach the durable step detail.
      const serialized = JSON.stringify(data)
      expect(serialized).not.toContain('amcore:user-data-')
      expect(serialized).not.toContain('ignore all previous instructions')
    })

    it('caps the persisted category list length defensively', async () => {
      const many = Array.from({ length: 30 }, (_, i) => ({ category: `cat_${i}`, count: 1 }))
      await repo.finalizeRefusal(claim(), refusal({ categories: many }))
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { detail?: { categories: unknown[] } }[] },
      ]
      expect(data[0]!.detail!.categories).toHaveLength(16)
    })

    it('CAS loss → returns false (message + steps + terminal update roll back together)', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
      await expect(repo.finalizeRefusal(claim(), refusal())).resolves.toBe(false)
    })

    it('records the output-block reason + OUTPUT_VALIDATION check step', async () => {
      await repo.finalizeRefusal(
        claim(),
        refusal({
          reasonCode: AiRunTerminalReason.GUARDRAIL_OUTPUT_BLOCKED,
          checkStepType: AiRunStepType.OUTPUT_VALIDATION,
        })
      )
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { type: string }[] },
      ]
      expect(data.map((s) => s.type)).toEqual(['OUTPUT_VALIDATION', 'REFUSAL'])
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ terminalReasonCode: 'guardrail_output_blocked' }),
        })
      )
    })
  })

  describe('finalizeRetry', () => {
    it('re-queues with a future nextAttemptAt while attempts remain', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      const outcome = await repo.finalizeRetry(
        prisma,
        claim({ attemptNumber: 1 }),
        'provider_timeout'
      )
      expect(outcome.state).toBe('retry_scheduled')
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) })
      )
    })

    it('fails terminally once attempts are exhausted', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      const outcome = await repo.finalizeRetry(
        prisma,
        claim({ attemptNumber: 3, maxAttempts: 3 }),
        'provider_unavailable'
      )
      expect(outcome).toEqual({ state: 'failed', reasonCode: 'attempts_exhausted' })
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            terminalReasonCode: 'attempts_exhausted',
          }),
        })
      )
    })

    it('reports lease_lost when the CAS matches no row', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
      const outcome = await repo.finalizeRetry(prisma, claim(), 'provider_timeout')
      expect(outcome).toEqual({ state: 'lease_lost' })
    })
  })

  describe('reapExpiredLeases', () => {
    it('re-queues a reclaimed run with attempts remaining', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'run-1', attemptCount: 1, maxAttempts: 3, deadlineAt: null },
      ] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 1, failed: 0 })
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) })
      )
    })

    it('fails a reclaimed run whose attempts are exhausted', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'run-1', attemptCount: 3, maxAttempts: 3, deadlineAt: null },
      ] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 0, failed: 1 })
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', errorCode: 'lease_expired' }),
        })
      )
    })

    it('expires a reclaimed run whose deadline has already passed', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'run-1', attemptCount: 1, maxAttempts: 3, deadlineAt: new Date(0) },
      ] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 0, failed: 1 })
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'EXPIRED',
            errorCode: null,
            terminalReasonCode: 'deadline_exceeded',
          }),
        })
      )
    })
  })

  describe('expireDeadlinedRuns', () => {
    it('expires overdue queued runs and returns the count', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }] as never)
      const count = await repo.expireDeadlinedRuns()
      expect(count).toBe(2)
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'EXPIRED',
            terminalReasonCode: 'deadline_exceeded',
          }),
        })
      )
    })
  })
})
