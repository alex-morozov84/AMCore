import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { AiRunRealtimePublisher } from '../../../core/ai/realtime/ai-run-realtime.publisher'
import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiTextResult } from '../gateway/ai-gateway.types'
import type { ModelGateway } from '../gateway/model-gateway.service'

import type { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunExecutorService } from './ai-run-executor.service'

import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the durable AI run executor (Track C — ADR-054, Arc C.4/C.5). Focus: the pre-flight
 * short-circuits (cancel/deadline/bad input never call the provider), the exactly-one provider
 * call, the single finalization transaction, the at-least-once recovery property (provider
 * succeeds, finalize fails, recovery retries → one terminal message + one ledger row, provider
 * possibly invoked twice), and the best-effort content-free status hint (C.5).
 */

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

function textResult(over: Partial<AiTextResult> = {}): AiTextResult {
  return {
    text: 'hello',
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    modelSlug: 'claude-default',
    providerType: 'MOCK' as AiTextResult['providerType'],
    ...over,
  }
}

describe('AiRunExecutorService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let gateway: { generateText: jest.Mock }
  let repository: DeepMockProxy<AiRunRepository>
  let publisher: { publish: jest.Mock }
  let executor: AiRunExecutorService

  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaService>()
    gateway = { generateText: jest.fn() }
    repository = mockDeep<AiRunRepository>()
    publisher = { publish: jest.fn().mockResolvedValue(undefined) }
    executor = new AiRunExecutorService(
      prisma,
      gateway as unknown as ModelGateway,
      repository,
      publisher as unknown as AiRunRealtimePublisher,
      logger as never
    )

    // Happy pre-flight defaults; individual tests override. The single object satisfies both the
    // pre-flight read (cancellation/deadline) and the post-attempt status-hint read (status + owner).
    prisma.aiRun.findUnique.mockResolvedValue({
      cancellationRequestedAt: null,
      deadlineAt: null,
      status: 'COMPLETED',
      conversation: { ownerUserId: 'u1' },
    } as never)
    prisma.aiConversation.findUnique.mockResolvedValue({
      ownerUserId: 'u1',
      organizationId: null,
    } as never)
    prisma.aiMessage.findFirst.mockResolvedValue({
      content: [{ type: 'text', text: 'hi there' }],
    } as never)
    prisma.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: 0 } } as never)
    prisma.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    prisma.aiRunStep.createMany.mockResolvedValue({ count: 2 } as never)
    prisma.$queryRaw.mockResolvedValue([{ id: 'conv-1' }] as never)
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    gateway.generateText.mockResolvedValue(textResult())
    repository.finalizeCompleted.mockResolvedValue(true)
  })

  describe('successful generation', () => {
    it('calls the provider exactly once and finalizes message + ledger + terminal CAS in one tx', async () => {
      await executor.execute(claim())

      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      // Model resolved from the frozen snapshot slug, never the current default, and usage is not
      // recorded by the gateway (the executor owns the durable ledger write).
      expect(gateway.generateText).toHaveBeenCalledWith(
        expect.objectContaining({ modelSlug: 'claude-default', recordUsage: false })
      )
      expect(prisma.aiMessage.create).toHaveBeenCalledTimes(1)
      expect(prisma.aiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ runId: 'run-1', role: 'ASSISTANT', sequence: 1 }),
        })
      )
      expect(prisma.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(prisma.aiUsageLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: 'run-1',
            conversationId: 'conv-1',
            userId: 'u1',
            modelSlug: 'claude-default',
            inputTokens: 1,
            outputTokens: 2,
          }),
        })
      )
      expect(prisma.aiRunStep.createMany).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
    })

    it('locks the conversation row FOR UPDATE before allocating the assistant sequence', async () => {
      await executor.execute(claim())
      // The FOR UPDATE lock (a raw query) must precede the max-sequence read, so concurrent
      // finalizations on one conversation serialize and cannot collide on the unique sequence.
      const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0]
      const seqOrder = prisma.aiMessage.aggregate.mock.invocationCallOrder[0]
      expect(lockOrder).toBeDefined()
      expect(seqOrder).toBeDefined()
      expect(lockOrder).toBeLessThan(seqOrder as number)
    })

    it('feeds the run OWN input turn (by runId) as the user message', async () => {
      await executor.execute(claim())
      expect(prisma.aiMessage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { runId: 'run-1', role: 'USER' } })
      )
      expect(gateway.generateText).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [{ role: 'user', content: 'hi there' }] })
      )
    })
  })

  describe('pre-flight short-circuits (no provider call)', () => {
    it('cancels without calling the provider when cancellation was requested', async () => {
      prisma.aiRun.findUnique.mockResolvedValue({
        cancellationRequestedAt: new Date(),
        deadlineAt: null,
      } as never)
      await executor.execute(claim())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeCancelled).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ id: 'run-1' }),
        'cancelled_by_user'
      )
    })

    it('expires without calling the provider when the deadline has passed', async () => {
      prisma.aiRun.findUnique.mockResolvedValue({
        cancellationRequestedAt: null,
        deadlineAt: new Date(0),
      } as never)
      await executor.execute(claim())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeExpired).toHaveBeenCalledTimes(1)
    })

    it('permanently fails a run whose snapshot carries no model slug', async () => {
      await executor.execute(claim({ modelSnapshot: { providerType: 'MOCK' } }))
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'model_snapshot_invalid'
      )
    })

    it('permanently fails when the run has no input turn', async () => {
      prisma.aiMessage.findFirst.mockResolvedValue(null as never)
      await executor.execute(claim())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'input_missing'
      )
    })

    it('permanently fails when the input turn has no text part', async () => {
      prisma.aiMessage.findFirst.mockResolvedValue({
        content: [{ type: 'artifact_ref', artifactId: 'a1' }],
      } as never)
      await executor.execute(claim())
      expect(gateway.generateText).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'no_input_text'
      )
    })
  })

  describe('gateway failures', () => {
    it('schedules a retry on a retryable gateway error', async () => {
      gateway.generateText.mockRejectedValue(AiGatewayException.providerUnavailable('MOCK'))
      await executor.execute(claim())
      expect(repository.finalizeRetry).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'provider_unavailable'
      )
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
    })

    it('terminally fails on a permanent gateway error', async () => {
      gateway.generateText.mockRejectedValue(AiGatewayException.providerRejected('MOCK'))
      await executor.execute(claim())
      expect(repository.finalizeFailed).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'provider_rejected'
      )
      expect(repository.finalizeRetry).not.toHaveBeenCalled()
    })

    it('retries defensively on an unexpected non-gateway error', async () => {
      gateway.generateText.mockRejectedValue(new Error('boom'))
      await executor.execute(claim())
      expect(repository.finalizeRetry).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'unknown_error'
      )
    })
  })

  describe('finalization atomicity + at-least-once recovery', () => {
    it('leaves the run non-terminal when the finalize transaction fails (no terminal CAS)', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('db down') as never)
      await executor.execute(claim())
      // Provider was called, but the run was NOT terminally completed/failed — recovery will retry.
      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCompleted).not.toHaveBeenCalled()
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalled()
    })

    it('provider succeeds, first finalize fails, recovery retries → one message + one ledger, provider twice', async () => {
      // Attempt 1: provider ok, finalize tx rejects (nothing persisted — rolled back).
      prisma.$transaction.mockRejectedValueOnce(new Error('db down') as never)
      await executor.execute(claim({ attemptNumber: 1 }))

      // Attempt 2 (recovery reclaimed the expired lease → fresh claim): provider ok, finalize ok.
      await executor.execute(claim({ attemptNumber: 2, leaseToken: 'lease-def' }))

      expect(gateway.generateText).toHaveBeenCalledTimes(2)
      // The assistant message + ledger row are written exactly once — only in the committed tx.
      expect(prisma.aiMessage.create).toHaveBeenCalledTimes(1)
      expect(prisma.aiUsageLedger.create).toHaveBeenCalledTimes(1)
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
    })

    it('rolls back the transcript and does not re-finalize when the terminal CAS loses the lease', async () => {
      repository.finalizeCompleted.mockResolvedValue(false)
      await executor.execute(claim())
      expect(gateway.generateText).toHaveBeenCalledTimes(1)
      // Lease lost is not a run failure — no terminal-failed transition, warn (not error) logged.
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai.run.finalize_lease_lost' }),
        expect.any(String)
      )
    })
  })

  describe('realtime status hint (C.5)', () => {
    it('publishes a content-free hint with the committed status + owner after a successful attempt', async () => {
      await executor.execute(claim())
      // Owner + run id + lowercase status + the single bounded reason — no prompt/response/slug.
      expect(publisher.publish).toHaveBeenCalledWith('u1', 'run-1', 'completed', 'status_changed')
      expect(publisher.publish).toHaveBeenCalledTimes(1)
    })

    it('still publishes the current status when the attempt failed permanently', async () => {
      gateway.generateText.mockRejectedValue(AiGatewayException.providerRejected('MOCK'))
      prisma.aiRun.findUnique.mockResolvedValue({
        cancellationRequestedAt: null,
        deadlineAt: null,
        status: 'FAILED',
        conversation: { ownerUserId: 'u1' },
      } as never)
      await executor.execute(claim())
      expect(publisher.publish).toHaveBeenCalledWith('u1', 'run-1', 'failed', 'status_changed')
    })

    it('never lets a hint failure escape or affect the run outcome', async () => {
      publisher.publish.mockRejectedValue(new Error('redis down'))
      await expect(executor.execute(claim())).resolves.toBeUndefined()
      expect(repository.finalizeCompleted).toHaveBeenCalledTimes(1)
    })

    it('does not publish when the run row vanished (hard-deleted mid-attempt)', async () => {
      // Pre-flight passes with the seeded object; the post-attempt hint read returns null.
      prisma.aiRun.findUnique
        .mockResolvedValueOnce({
          cancellationRequestedAt: null,
          deadlineAt: null,
        } as never)
        .mockResolvedValueOnce(null as never)
      await executor.execute(claim())
      expect(publisher.publish).not.toHaveBeenCalled()
    })
  })
})
