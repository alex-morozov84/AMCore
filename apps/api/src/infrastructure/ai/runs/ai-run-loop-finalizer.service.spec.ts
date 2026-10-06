import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiTextResult } from '../gateway/ai-gateway.types'

import type { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, StopCause } from './ai-run-dispatch.types'
import { type AiRunGuard, RunLeaseLostError } from './ai-run-guard.service'
import { AiRunLoopFinalizer } from './ai-run-loop-finalizer.service'
import type { RunPlan } from './ai-run-plan'
import type { AiRunTransitions } from './ai-run-transitions.service'

import { AiRunStepType } from '@/generated/prisma/client'
import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the loop finalizer (Track C — ADR-054). Every write runs in the run guard's `record`
 * mode: the guard (locks, fresh-clock lease, stop causes) is proved in its own spec and against Postgres
 * in e2e, so here it runs the callback inside a scripted transaction and reports the stop cause it was
 * given. Pinned behaviour: a visible stop cause (cancel / takeover / deadline) never loses the provider
 * step and its usage, never writes an assistant turn, and terminalizes as the STOP rather than as the
 * requested outcome.
 */

const CLAIM: ClaimedRun = {
  id: 'run-1',
  conversationId: 'conv-1',
  modelSnapshot: {},
  epoch: 1,
  attemptNumber: 1,
  maxAttempts: 3,
  deadlineAt: null,
  ownershipGeneration: 0,
  leaseToken: 'lease-abc',
}

const PLAN = {
  modelSlug: 'claude-default',
  attribution: { userId: 'u1', organizationId: null },
  inputFlagCategories: [{ category: 'instruction_override', count: 1 }],
} as unknown as RunPlan

const RESULT: AiTextResult = {
  text: 'final answer',
  finishReason: 'stop',
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  modelSlug: 'claude-default',
  providerType: 'MOCK' as AiTextResult['providerType'],
}

describe('AiRunLoopFinalizer', () => {
  let tx: DeepMockProxy<PrismaService>
  let guardResult: { kind: 'ok' | 'lease_lost' | 'cutoff' }
  let stop: StopCause | null
  let repository: DeepMockProxy<AiRunRepository>
  let transitions: {
    failed: jest.Mock
    retry: jest.Mock
    refusal: jest.Mock
    settleStop: jest.Mock
  }
  let metrics: { observeAiToolLoopSteps: jest.Mock }
  let finalizer: AiRunLoopFinalizer
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    stop = null
    guardResult = { kind: 'ok' }
    tx = mockDeep<PrismaService>()
    tx.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    tx.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: 0 } } as never)
    const guard = {
      record: jest.fn(async (_c: ClaimedRun, fn: (t: unknown, ctx: object) => Promise<unknown>) => {
        if (guardResult.kind !== 'ok') return guardResult
        try {
          return { kind: 'ok', value: await fn(tx, { stop, epoch: 1 }), stop }
        } catch (error) {
          if (error instanceof RunLeaseLostError) return { kind: 'lease_lost' }
          throw error
        }
      }),
    }
    repository = mockDeep<AiRunRepository>()
    repository.finalizeCompleted.mockResolvedValue(true)
    repository.finalizeFailed.mockResolvedValue(true)
    repository.finalizeCancelled.mockResolvedValue(true)
    repository.finalizeSuperseded.mockResolvedValue(true)
    repository.finalizeExpired.mockResolvedValue(true)
    transitions = {
      failed: jest.fn().mockResolvedValue('applied'),
      retry: jest.fn().mockResolvedValue({ state: 'retry_scheduled' }),
      refusal: jest.fn().mockResolvedValue('applied'),
      settleStop: jest.fn().mockResolvedValue('applied'),
    }
    metrics = { observeAiToolLoopSteps: jest.fn() }
    finalizer = new AiRunLoopFinalizer(
      guard as unknown as AiRunGuard,
      repository,
      transitions as unknown as AiRunTransitions,
      metrics as unknown as MetricsService,
      logger as never
    )
  })

  describe('success', () => {
    it('writes the assistant turn + step trail + per-call ledger + terminal CAS in ONE guarded transaction', async () => {
      await finalizer.success(CLAIM, PLAN, RESULT, 7, 1)

      expect(tx.aiMessage.create).toHaveBeenCalledTimes(1)
      const steps = (tx.aiRunStep.createMany.mock.calls[0]![0] as { data: { type: string }[] }).data
      expect(steps.map((s) => s.type)).toEqual([
        AiRunStepType.GUARDRAIL_CHECK, // the flagged input check recorded with the final write
        AiRunStepType.PROVIDER_CALL,
        AiRunStepType.FINALIZATION,
      ])
      expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('completed', 1)
    })

    it.each(['cancelled', 'superseded', 'expired'] as const)(
      'a visible %s stop keeps the provider step + usage, writes NO assistant turn, and terminalizes as the stop',
      async (cause) => {
        stop = cause
        const finalizerOf = {
          cancelled: repository.finalizeCancelled,
          superseded: repository.finalizeSuperseded,
          expired: repository.finalizeExpired,
        }[cause]

        await finalizer.success(CLAIM, PLAN, RESULT, 7, 1)

        const steps = (tx.aiRunStep.createMany.mock.calls[0]![0] as { data: { type: string }[] })
          .data
        expect(steps.map((s) => s.type)).toEqual([AiRunStepType.PROVIDER_CALL]) // spend kept, no FINALIZATION
        expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
        expect(tx.aiMessage.create).not.toHaveBeenCalled() // no stale bot turn into a stopped conversation
        expect(finalizerOf).toHaveBeenCalledTimes(1)
        expect(repository.finalizeCompleted).not.toHaveBeenCalled()
        expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
      }
    )

    it('a lost lease writes nothing and records no metric (recovery owns the run)', async () => {
      guardResult = { kind: 'lease_lost' }

      await finalizer.success(CLAIM, PLAN, RESULT, 7, 1)

      expect(tx.aiMessage.create).not.toHaveBeenCalled()
      expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai.run.finalize_not_committed', kind: 'lease_lost' }),
        expect.any(String)
      )
    })

    it('rolls back (reports lease lost) when the terminal CAS loses the lease', async () => {
      repository.finalizeCompleted.mockResolvedValue(false)

      await finalizer.success(CLAIM, PLAN, RESULT, 7, 1)

      expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
    })
  })

  describe('afterProviderFailure', () => {
    it('records the call + usage and fails the run with the policy reason', async () => {
      await finalizer.afterProviderFailure(CLAIM, PLAN, RESULT, 7, 'too_many_tool_calls', 1)

      expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        tx,
        CLAIM,
        'tool_loop_failed',
        'too_many_tool_calls'
      )
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('failed', 1)
    })

    it('a visible stop still records the spend but terminalizes as the stop, not the failure', async () => {
      stop = 'cancelled'

      await finalizer.afterProviderFailure(CLAIM, PLAN, RESULT, 7, 'too_many_tool_calls', 1)

      expect(tx.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCancelled).toHaveBeenCalledTimes(1)
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
    })
  })

  describe('delegated transitions', () => {
    it('exhausted → a guarded failure with the loop-exhausted reason, then the bounded metric', async () => {
      await finalizer.exhausted(CLAIM, 8)

      expect(transitions.failed).toHaveBeenCalledWith(
        CLAIM,
        'tool_loop_failed',
        'tool_loop_exhausted'
      )
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('exhausted', 8)
    })

    it('outputBlocked → a guarded canned refusal with the OUTPUT_VALIDATION check step', async () => {
      await finalizer.outputBlocked(CLAIM, [{ category: 'envelope_marker_abuse', count: 1 }], 2)

      expect(transitions.refusal).toHaveBeenCalledWith(
        CLAIM,
        expect.objectContaining({
          reasonCode: 'guardrail_output_blocked',
          checkStepType: AiRunStepType.OUTPUT_VALIDATION,
        })
      )
      expect(metrics.observeAiToolLoopSteps).toHaveBeenCalledWith('failed', 2)
    })

    it('does not count a metric when the transition was not applied (lease lost)', async () => {
      transitions.failed.mockResolvedValue('lease_lost')

      await finalizer.exhausted(CLAIM, 8)

      expect(metrics.observeAiToolLoopSteps).not.toHaveBeenCalled()
    })
  })

  describe('gatewayError', () => {
    it('retries a retryable gateway error under its bounded code', async () => {
      await finalizer.gatewayError(CLAIM, AiGatewayException.providerUnavailable('MOCK' as never))

      expect(transitions.retry).toHaveBeenCalledWith(CLAIM, 'provider_unavailable')
      expect(transitions.failed).not.toHaveBeenCalled()
    })

    it('fails a permanent gateway error without a retry', async () => {
      await finalizer.gatewayError(CLAIM, AiGatewayException.contentFiltered('MOCK' as never))

      expect(transitions.failed).toHaveBeenCalledWith(CLAIM, 'content_filtered')
      expect(transitions.retry).not.toHaveBeenCalled()
    })

    it('retries defensively on an unexpected non-gateway error', async () => {
      await finalizer.gatewayError(CLAIM, new Error('weird'))

      expect(transitions.retry).toHaveBeenCalledWith(CLAIM, 'unknown_error')
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('callerAborted', () => {
    it('shutdown: writes NOTHING (the seal never writes; lease expiry recovers the run)', async () => {
      await finalizer.callerAborted(CLAIM, 'shutdown')

      expect(transitions.settleStop).not.toHaveBeenCalled()
      expect(transitions.retry).not.toHaveBeenCalled()
      expect(transitions.failed).not.toHaveBeenCalled()
    })

    it('deadline: terminalizes via the stop path (a higher-precedence stop still wins there), never a retry', async () => {
      await finalizer.callerAborted(CLAIM, 'deadline')

      expect(transitions.settleStop).toHaveBeenCalledWith(CLAIM, 'expired')
      expect(transitions.retry).not.toHaveBeenCalled()
    })
  })
})
