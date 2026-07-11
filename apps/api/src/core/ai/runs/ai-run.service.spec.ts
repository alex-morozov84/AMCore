import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { NotFoundException } from '../../../common/exceptions'

import { AiRunService } from './ai-run.service'

import type { AuditLogService } from '@/core/audit'
import type { PrismaService } from '@/prisma'

function fakeRun(
  ownerUserId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    status: 'RUNNING',
    errorCode: null,
    terminalReasonCode: null,
    cancellationRequestedAt: null,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    startedAt: new Date('2026-06-26T00:00:01.000Z'),
    finishedAt: null,
    conversation: { ownerUserId },
    approvals: [], // no pending approval by default (getOwned's pendingApprovalId hint)
    ...overrides,
  }
}

function listRow(id: string, createdAt: string): Record<string, unknown> {
  return {
    id,
    conversationId: 'conv-1',
    status: 'QUEUED',
    errorCode: null,
    terminalReasonCode: null,
    createdAt: new Date(createdAt),
    startedAt: null,
    finishedAt: null,
  }
}

describe('AiRunService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: { record: jest.Mock }
  let service: AiRunService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    prisma.$queryRaw.mockResolvedValue([] as never) // no pending approval to lock by default
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    service = new AiRunService(prisma, audit as unknown as AuditLogService)
  })

  it('fetches an owned run and projects status to a lowercase wire value', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(fakeRun('user-1') as never)

    await expect(service.getOwned('user-1', 'run-1')).resolves.toMatchObject({
      id: 'run-1',
      status: 'running',
    })
  })

  it('surfaces the pending approval id on a parked run fetch (Arc E.5)', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(
      fakeRun('user-1', {
        status: 'WAITING_APPROVAL',
        approvals: [{ id: 'appr-9' }],
      }) as never
    )
    await expect(service.getOwned('user-1', 'run-1')).resolves.toMatchObject({
      status: 'waiting_approval',
      pendingApprovalId: 'appr-9',
    })
  })

  it('hides a run whose conversation is owned by someone else (404)', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(fakeRun('other') as never)

    await expect(service.getOwned('user-1', 'run-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('404s a missing run', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null)

    await expect(service.getOwned('user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException)
  })

  describe('list', () => {
    it('returns a page scoped to the owner with no next cursor when the page is short', async () => {
      prisma.aiRun.findMany.mockResolvedValue([
        listRow('run-2', '2026-06-26T00:00:02.000Z'),
        listRow('run-1', '2026-06-26T00:00:01.000Z'),
      ] as never)

      const page = await service.list('user-1', { limit: 20 })

      expect(page.hasMore).toBe(false)
      expect(page.nextCursor).toBeNull()
      expect(page.data.map((r) => r.id)).toEqual(['run-2', 'run-1'])
      // Owner-scoped query, newest-first keyset order.
      expect(prisma.aiRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ conversation: { ownerUserId: 'user-1' } }),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        })
      )
    })

    it('emits a next cursor and trims the extra row when more remain', async () => {
      prisma.aiRun.findMany.mockResolvedValue([
        listRow('run-2', '2026-06-26T00:00:02.000Z'),
        listRow('run-1', '2026-06-26T00:00:01.000Z'),
      ] as never)

      const page = await service.list('user-1', { limit: 1 })

      expect(page.hasMore).toBe(true)
      expect(page.data.map((r) => r.id)).toEqual(['run-2'])
      expect(page.nextCursor).toBeTruthy()
    })

    it('filters by conversationId when provided', async () => {
      prisma.aiRun.findMany.mockResolvedValue([] as never)

      await service.list('user-1', { limit: 20, conversationId: 'conv-9' })

      expect(prisma.aiRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ conversationId: 'conv-9' }),
        })
      )
    })
  })

  describe('cancel', () => {
    it('claims a QUEUED run to terminal CANCELLED', async () => {
      prisma.aiRun.findUnique.mockResolvedValue(fakeRun('user-1', { status: 'QUEUED' }) as never)
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      prisma.aiRun.findUniqueOrThrow.mockResolvedValue(
        fakeRun('user-1', {
          status: 'CANCELLED',
          finishedAt: new Date(),
          terminalReasonCode: 'cancelled_by_user',
        }) as never
      )

      const result = await service.cancel('user-1', 'run-1')

      expect(result).toEqual({ id: 'run-1', status: 'cancelled', cancellationRequested: true })
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'run-1', status: 'QUEUED' } })
      )
    })

    it('records a cooperative request for a RUNNING run (CAS to QUEUED misses)', async () => {
      prisma.aiRun.findUnique.mockResolvedValue(fakeRun('user-1', { status: 'RUNNING' }) as never)
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
      prisma.aiRun.findUniqueOrThrow.mockResolvedValue(
        fakeRun('user-1', { status: 'RUNNING', cancellationRequestedAt: new Date() }) as never
      )

      const result = await service.cancel('user-1', 'run-1')

      expect(result).toEqual({ id: 'run-1', status: 'running', cancellationRequested: true })
      // Second updateMany targets the RUNNING cooperative-request path.
      expect(prisma.aiRun.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', status: 'RUNNING', cancellationRequestedAt: null },
        })
      )
    })

    it('is an idempotent no-op on a terminal run (no writes)', async () => {
      prisma.aiRun.findUnique.mockResolvedValue(fakeRun('user-1', { status: 'COMPLETED' }) as never)
      prisma.aiRun.findUniqueOrThrow.mockResolvedValue(
        fakeRun('user-1', { status: 'COMPLETED' }) as never
      )

      const result = await service.cancel('user-1', 'run-1')

      expect(result).toEqual({ id: 'run-1', status: 'completed', cancellationRequested: false })
      expect(prisma.aiRun.updateMany).not.toHaveBeenCalled()
    })

    it('404s a run owned by someone else (no write)', async () => {
      prisma.aiRun.findUnique.mockResolvedValue(fakeRun('other', { status: 'QUEUED' }) as never)

      await expect(service.cancel('user-1', 'run-1')).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.aiRun.updateMany).not.toHaveBeenCalled()
    })

    describe('cancel-while-waiting (Arc E.5)', () => {
      it('locks approval+run (FOR UPDATE OF a, r) BEFORE mutating, then cancels + voids + skips, in-tx audit', async () => {
        prisma.aiRun.findUnique.mockResolvedValue(
          fakeRun('user-1', { status: 'WAITING_APPROVAL' }) as never
        )
        // The raw lock query returns the pending approval to cancel under the held locks.
        prisma.$queryRaw.mockResolvedValue([{ approvalId: 'appr-1' }] as never)
        // QUEUED CAS misses (count 0); the WAITING_APPROVAL CAS matches one row.
        prisma.aiRun.updateMany
          .mockResolvedValueOnce({ count: 0 } as never) // QUEUED attempt
          .mockResolvedValueOnce({ count: 1 } as never) // WAITING_APPROVAL → CANCELLED
        prisma.aiApproval.updateMany.mockResolvedValue({ count: 1 } as never)
        prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
        prisma.aiRun.findUniqueOrThrow.mockResolvedValue(
          fakeRun('user-1', { status: 'CANCELLED' }) as never
        )

        const result = await service.cancel('user-1', 'run-1')

        expect(result.status).toBe('cancelled')
        // Lock-order safety: the raw FOR UPDATE lock precedes the approval + invocation mutations.
        const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0]!
        expect(lockOrder).toBeLessThan(prisma.aiApproval.updateMany.mock.invocationCallOrder[0]!)
        expect(lockOrder).toBeLessThan(
          prisma.aiToolInvocation.updateMany.mock.invocationCallOrder[0]!
        )
        expect(prisma.aiApproval.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'appr-1', state: 'PENDING' },
            data: { state: 'EXPIRED' },
          })
        )
        expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { runId: 'run-1', status: 'AWAITING_APPROVAL' },
            data: { status: 'SKIPPED' },
          })
        )
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'ai.approval.expired',
            metadata: expect.objectContaining({ reasonCode: 'run_cancelled' }),
          }),
          { tx: prisma }
        )
      })

      it('is a no-op (RUNNING fallthrough) when no pending approval is lockable', async () => {
        prisma.aiRun.findUnique.mockResolvedValue(fakeRun('user-1', { status: 'RUNNING' }) as never)
        prisma.$queryRaw.mockResolvedValue([] as never) // no parked approval to lock
        prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
        prisma.aiRun.findUniqueOrThrow.mockResolvedValue(
          fakeRun('user-1', { status: 'RUNNING', cancellationRequestedAt: new Date() }) as never
        )

        await service.cancel('user-1', 'run-1')

        expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
        // Fell through to the RUNNING cooperative-request path.
        expect(prisma.aiRun.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: { id: 'run-1', status: 'RUNNING', cancellationRequestedAt: null },
          })
        )
      })

      it('rolls back (no audit) when the gated invocation raced out of AWAITING_APPROVAL', async () => {
        prisma.aiRun.findUnique.mockResolvedValue(
          fakeRun('user-1', { status: 'WAITING_APPROVAL' }) as never
        )
        prisma.$queryRaw.mockResolvedValue([{ approvalId: 'appr-1' }] as never)
        prisma.aiRun.updateMany
          .mockResolvedValueOnce({ count: 0 } as never) // QUEUED attempt
          .mockResolvedValueOnce({ count: 1 } as never) // WAITING_APPROVAL → CANCELLED
          .mockResolvedValueOnce({ count: 0 } as never) // RUNNING cooperative attempt (fallthrough)
        prisma.aiApproval.updateMany.mockResolvedValue({ count: 1 } as never)
        prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never) // raced
        prisma.aiRun.findUniqueOrThrow.mockResolvedValue(
          fakeRun('user-1', { status: 'WAITING_APPROVAL' }) as never
        )

        await service.cancel('user-1', 'run-1')

        // The transaction threw the race sentinel → rolled back → no committed audit.
        expect(audit.record).not.toHaveBeenCalled()
      })
    })
  })
})
