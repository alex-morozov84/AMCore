import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AI_RUN_CLAIM_BATCH_LIMIT, AI_RUN_MAX_DRAIN_CYCLES } from './ai-run.constants'
import type { AiRunRepository } from './ai-run.repository'
import { AiRunDispatchService } from './ai-run-dispatch.service'
import type { ClaimedRun } from './ai-run-dispatch.types'
import type { AiRunExecutorService } from './ai-run-executor.service'

/**
 * Unit tests for the AI run dispatcher (Track C — ADR-054, Arc C.4): the reap + bounded-drain loop
 * that both the wake job and the recovery cron drive. It owns no provider I/O; it claims through the
 * repository and hands each claim to the executor.
 */

function claim(id: string): ClaimedRun {
  return {
    id,
    conversationId: 'conv-1',
    modelSnapshot: { modelSlug: 'm' },
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: null,
    leaseToken: 'lease',
  }
}

function fullBatch(): ClaimedRun[] {
  return Array.from({ length: AI_RUN_CLAIM_BATCH_LIMIT }, (_, i) => claim(`run-${i}`))
}

describe('AiRunDispatchService', () => {
  let repository: DeepMockProxy<AiRunRepository>
  let executor: { execute: jest.Mock }
  let service: AiRunDispatchService
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    repository = mockDeep<AiRunRepository>()
    executor = { execute: jest.fn().mockResolvedValue(undefined) }
    service = new AiRunDispatchService(
      repository,
      executor as unknown as AiRunExecutorService,
      logger as never
    )
    repository.reapExpiredLeases.mockResolvedValue({ rescheduled: 0, failed: 0 })
    repository.expireDeadlinedRuns.mockResolvedValue(0)
  })

  describe('drainDueBatches', () => {
    it('executes every claim and stops after a short (non-full) batch', async () => {
      repository.claimDueBatch.mockResolvedValueOnce([claim('run-1'), claim('run-2')])
      await service.drainDueBatches()
      expect(executor.execute).toHaveBeenCalledTimes(2)
      expect(repository.claimDueBatch).toHaveBeenCalledTimes(1)
    })

    it('returns immediately on an empty batch', async () => {
      repository.claimDueBatch.mockResolvedValueOnce([])
      await service.drainDueBatches()
      expect(executor.execute).not.toHaveBeenCalled()
    })

    it('stops after the drain-cycle cap even when batches stay full', async () => {
      repository.claimDueBatch.mockResolvedValue(fullBatch())
      await service.drainDueBatches()
      expect(repository.claimDueBatch).toHaveBeenCalledTimes(AI_RUN_MAX_DRAIN_CYCLES)
      expect(executor.execute).toHaveBeenCalledTimes(
        AI_RUN_MAX_DRAIN_CYCLES * AI_RUN_CLAIM_BATCH_LIMIT
      )
    })
  })

  describe('runDispatchCycle', () => {
    it('reaps expired leases and overdue runs before draining', async () => {
      repository.claimDueBatch.mockResolvedValueOnce([])
      await service.runDispatchCycle()
      expect(repository.reapExpiredLeases).toHaveBeenCalledTimes(1)
      expect(repository.expireDeadlinedRuns).toHaveBeenCalledTimes(1)
      expect(repository.claimDueBatch).toHaveBeenCalled()
    })
  })
})
