import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'

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
