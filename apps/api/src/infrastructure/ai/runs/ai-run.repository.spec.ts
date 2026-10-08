import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import {
  AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION,
  AI_RUN_GUARDRAIL_REFUSAL_MESSAGE,
  AiRunTerminalReason,
} from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, GuardrailRefusalInput } from './ai-run-dispatch.types'

import { AiRunStepType } from '@/generated/prisma/client'
import { ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

function claim(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    modelSnapshot: { modelSlug: 'claude-default' },
    epoch: 2,
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: null,
    ownershipGeneration: 0,
    leaseToken: 'lease-abc',
    ...overrides,
  }
}

describe('AiRunRepository', () => {
  let prisma: DeepMockProxy<PrismaService>
  let repo: AiRunRepository
  let latch: ShutdownLatch

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    latch = new ShutdownLatch({ warn: jest.fn() }, 'ai.run')
    repo = new AiRunRepository(prisma, latch)
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
  })

  describe('claimDueBatch', () => {
    it('maps claimed rows to ClaimedRun: the new epoch, the retry ordinal (retries + 1) and a lease token', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'run-1',
          conversationId: 'conv-1',
          modelSnapshot: { modelSlug: 'claude-default' },
          attemptCount: 1, // consumed retries — the claim itself spends no budget
          maxAttempts: 3,
          deadlineAt: null,
          ownershipGeneration: 4,
          leaseEpoch: 5,
        },
      ] as never)

      const [run] = await repo.claimDueBatch()

      expect(run).toMatchObject({
        id: 'run-1',
        epoch: 5,
        attemptNumber: 2,
        maxAttempts: 3,
        ownershipGeneration: 4,
      })
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

    it('finalizeSuperseded CASes RUNNING → CANCELLED / superseded_by_human (ADR-049 fence, Arc F)', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      await expect(repo.finalizeSuperseded(prisma, claim())).resolves.toBe(true)
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', status: 'RUNNING', leaseToken: 'lease-abc' },
          data: expect.objectContaining({
            status: 'CANCELLED',
            terminalReasonCode: 'superseded_by_human',
            leaseToken: null,
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
      // The conversation lock + fence are the run guard's job (proved in its own spec): here the
      // refusal write only composes into the caller's guarded transaction.
      prisma.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: 0 } } as never)
      prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
      prisma.aiMessage.create.mockResolvedValue({} as never)
      prisma.aiRunStep.createMany.mockResolvedValue({ count: 2 } as never)
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
    })

    it('CAS win → terminal FAILED (non-retryable) with the guardrail terminalReasonCode', async () => {
      await expect(repo.finalizeRefusal(prisma, claim(), refusal())).resolves.toBe(true)
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
      await repo.finalizeRefusal(prisma, claim(), refusal())
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
      await repo.finalizeRefusal(prisma, claim(), refusal())
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

    it('omits step detail when no categories are supplied', async () => {
      await repo.finalizeRefusal(prisma, claim(), refusal({ categories: [] }))
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { detail?: unknown }[] },
      ]
      expect(data[0]!.detail).toBeUndefined()
    })

    it('defensively drops malicious/invalid categories (marker, snippet, bad count) from detail', async () => {
      await repo.finalizeRefusal(
        prisma,
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
      await repo.finalizeRefusal(prisma, claim(), refusal({ categories: many }))
      const [{ data }] = prisma.aiRunStep.createMany.mock.calls.at(-1) as unknown as [
        { data: { detail?: { categories: unknown[] } }[] },
      ]
      expect(data[0]!.detail!.categories).toHaveLength(16)
    })

    it('CAS loss → returns false so the guarded transaction rolls message + steps + terminal back together', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
      await expect(repo.finalizeRefusal(prisma, claim(), refusal())).resolves.toBe(false)
    })

    it('records the output-block reason + OUTPUT_VALIDATION check step', async () => {
      await repo.finalizeRefusal(
        prisma,
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

  describe('attempt history + in-flight tools close with the transition', () => {
    /** SQL text of every raw statement executed inside the transaction. */
    function executedSql(): string[] {
      return prisma.$executeRaw.mock.calls.map((call) =>
        (call[0] as unknown as { strings: string[] }).strings.join('?')
      )
    }

    it("closes the epoch's attempt row in the same transaction as a terminal CAS", async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)

      await repo.finalizeFailed(prisma, claim(), 'provider_rejected')

      const attempt = executedSql().find((sql) => sql.includes('"ai"."ai_run_attempts"'))
      expect(attempt).toContain('"endedAt" IS NULL')
      expect(attempt).toContain('epoch =')
    })

    it('resolves in-flight tools on a terminal transition: side-effecting EXECUTING → OUTCOME_UNKNOWN, unstarted → SKIPPED', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)

      await repo.finalizeCancelled(prisma, claim(), 'cancelled_by_user')

      const sql = executedSql().join('\n')
      expect(sql).toContain("'OUTCOME_UNKNOWN'")
      expect(sql).toContain("COALESCE(idempotency, 'idempotent') <> 'read_only'")
      expect(sql).toContain("'tool_abandoned'")
      expect(sql).toContain("'SKIPPED'")
    })

    it('writes nothing when the CAS lost (a stale holder closes no history, resolves no tool)', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)

      await expect(repo.finalizeCompleted(prisma, claim())).resolves.toBe(false)
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('parking for approval closes the attempt as awaiting_approval and leaves tools alone', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)

      await repo.parkForApproval(prisma, claim())

      expect(executedSql()).toHaveLength(1)
      expect(executedSql()[0]).toContain('"ai"."ai_run_attempts"')
    })
  })

  describe('finalizeRetry (retry budget counts consumed retries, never claims)', () => {
    beforeEach(() => {
      prisma.aiRun.findUnique.mockResolvedValue({ cancellationRequestedAt: null } as never)
    })

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ now: new Date(), anchor: new Date() }] as never)
      prisma.aiRun.findUniqueOrThrow.mockResolvedValue({ providerRetryRestriction: null } as never)
      prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    })

    it('re-queues with a future nextAttemptAt and records the retry ordinal as attemptCount', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      const outcome = await repo.finalizeRetry(
        prisma,
        claim({ attemptNumber: 2 }),
        'provider_timeout'
      )
      expect(outcome.state).toBe('retry_scheduled')
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'QUEUED', attemptCount: 2 }),
        })
      )
    })

    it('a fresh run still gets exactly maxAttempts executions (retry ordinals 1 and 2 re-queue, 3 fails)', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      const states: string[] = []
      for (const attemptNumber of [1, 2, 3]) {
        const outcome = await repo.finalizeRetry(
          prisma,
          claim({ attemptNumber, maxAttempts: 3 }),
          'provider_unavailable'
        )
        states.push(outcome.state)
      }
      expect(states).toEqual(['retry_scheduled', 'retry_scheduled', 'failed'])
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

    it('a recorded user cancel wins over a retry: the run is cancelled, never re-queued', async () => {
      prisma.aiRun.findUnique.mockResolvedValue({ cancellationRequestedAt: new Date() } as never)
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)

      const outcome = await repo.finalizeRetry(prisma, claim(), 'provider_timeout')

      expect(outcome).toEqual({ state: 'failed', reasonCode: 'cancelled_by_user' })
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            terminalReasonCode: 'cancelled_by_user',
          }),
        })
      )
      expect(prisma.aiRun.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) })
      )
    })

    it('reports lease_lost when the CAS matches no row', async () => {
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
      const outcome = await repo.finalizeRetry(prisma, claim(), 'provider_timeout')
      expect(outcome).toEqual({ state: 'lease_lost' })
    })
  })

  describe('reapExpiredLeases', () => {
    function reapRow(over: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'run-1',
        attemptCount: 0,
        maxAttempts: 3,
        deadlineAt: null,
        cancellationRequestedAt: null,
        leaseEpoch: 4,
        ioStarted: true,
        ...over,
      }
    }

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ now: new Date() }] as never)
    })

    it('re-queues a reclaimed run that may have started I/O, consuming one retry', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([reapRow({ attemptCount: 1 })] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 1, failed: 0 })
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'QUEUED', attemptCount: 2 }),
        })
      )
    })

    it('re-queues an attempt that NEVER admitted I/O without consuming retry budget (and with no backoff)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        reapRow({ attemptCount: 2, ioStarted: false }),
      ] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 1, failed: 0 })
      const [{ data }] = prisma.aiRun.update.mock.calls[0] as unknown as [
        { data: { attemptCount: number; nextAttemptAt: Date; status: string } },
      ]
      expect(data.status).toBe('QUEUED')
      expect(data.attemptCount).toBe(2)
    })

    it('never fails a pre-I/O reclaim as exhausted (the epoch cap bounds it instead)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        reapRow({ attemptCount: 2, ioStarted: false }),
      ] as never)
      const result = await repo.reapExpiredLeases()
      expect(result.failed).toBe(0)
    })

    it('fails a reclaimed run whose retries are exhausted and whose attempt may have started I/O', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([reapRow({ attemptCount: 2 })] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 0, failed: 1 })
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            errorCode: 'lease_expired',
            terminalReasonCode: 'attempts_exhausted',
          }),
        })
      )
    })

    it('expires a reclaimed run whose deadline has already passed', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([reapRow({ deadlineAt: new Date(0) })] as never)
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

    it('turns a reclaimed run with a recorded cancel into CANCELLED, not a requeue or a failure', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        reapRow({ cancellationRequestedAt: new Date(), attemptCount: 2 }),
      ] as never)
      const result = await repo.reapExpiredLeases()
      expect(result).toEqual({ rescheduled: 0, failed: 1 })
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            terminalReasonCode: 'cancelled_by_user',
          }),
        })
      )
    })

    it('reaps with SKIP LOCKED on the run row ONLY (never the conversation: no lock cycle with the guard)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never)
      await repo.reapExpiredLeases()
      const sql = (
        prisma.$queryRaw.mock.calls[0]![0] as unknown as { strings: string[] }
      ).strings.join('?')
      expect(sql).toContain('FOR UPDATE OF r SKIP LOCKED')
      expect(sql).not.toContain('ai_conversations')
      expect(sql).toContain('clock_timestamp()')
    })
  })

  describe('shutdown seal (sweeps run through the latch guarded transaction)', () => {
    it('a reaper transaction resumed AFTER the seal rolls its tail back: no later query, no update', async () => {
      const release = deferred()
      prisma.$queryRaw.mockImplementation((async () => {
        await release.promise // the first (lock) query of the sweep is still pending when the seal happens
        return [reapRow()]
      }) as never)
      const reaping = repo.reapExpiredLeases()
      await new Promise((resolve) => setImmediate(resolve))

      latch.seal()
      release.resolve()
      const result = await reaping

      expect(result).toEqual({ rescheduled: 0, failed: 0 }) // sealed: reported as nothing done
      expect(prisma.aiRun.update).not.toHaveBeenCalled() // the forbidden tail never reached the database
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it.each([
      ['expireDeadlinedRuns', 0],
      ['failEpochCappedRuns', 0],
    ] as const)('%s starts no transaction once sealed', async (method, empty) => {
      latch.seal()

      expect(await repo[method]()).toBe(empty)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    function reapRow(): Record<string, unknown> {
      return {
        id: 'run-1',
        attemptCount: 0,
        maxAttempts: 3,
        deadlineAt: null,
        cancellationRequestedAt: null,
        leaseEpoch: 1,
        ioStarted: true,
      }
    }
    function deferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }
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

  describe('failEpochCappedRuns', () => {
    it('fails queued runs whose attempt history is full (never evicting a row) and resolves their tools', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'run-1' }] as never)
      const count = await repo.failEpochCappedRuns()
      expect(count).toBe(1)
      expect(prisma.aiRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            errorCode: 'attempt_history_exhausted',
            terminalReasonCode: 'attempts_exhausted',
          }),
        })
      )
      expect(prisma.aiRunStep.deleteMany).not.toHaveBeenCalled()
    })
  })
})
