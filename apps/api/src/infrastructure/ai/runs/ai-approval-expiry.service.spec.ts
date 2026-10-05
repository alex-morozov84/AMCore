import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AiApprovalExpiryService } from './ai-approval-expiry.service'

import type { AuditLogService } from '@/core/audit'
import type { MetricsService } from '@/infrastructure/observability'
import { ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the worker approval-expiry sweep (Track C — ADR-054, Arc E.5b). A REAL `expireApproval`
 * over a mocked Prisma verifies the per-item terminalize (approval EXPIRED + run EXPIRED/FAILED +
 * invocation SKIPPED/REJECTED) and that the `approvals{expired}` metric is emitted only per committed
 * expiry (post-commit), stopping cleanly when nothing is due.
 */

describe('AiApprovalExpiryService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: { record: jest.Mock }
  let metrics: { incAiApproval: jest.Mock }
  let latch: ShutdownLatch
  let service: AiApprovalExpiryService
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaService>()
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    prisma.aiApproval.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    metrics = { incAiApproval: jest.fn() }
    latch = new ShutdownLatch(logger as never, 'ai.run')
    service = new AiApprovalExpiryService(
      prisma,
      audit as unknown as AuditLogService,
      metrics as unknown as MetricsService,
      latch,
      logger as never
    )
  })

  /** One due approval = candidate select (unlocked), run lock (SKIP LOCKED), approval re-select + lock. */
  function due(deadlineAt: Date | null = null): void {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'appr-1', runId: 'run-1' }] as never)
      .mockResolvedValueOnce([{ id: 'run-1' }] as never)
      .mockResolvedValueOnce([{ id: 'appr-1', runId: 'run-1', deadlineAt }] as never)
  }

  it('terminalizes each due approval (TTL branch → FAILED/REJECTED) and counts one metric per commit', async () => {
    // First claim returns one TTL-expired approval (no deadline); second claim finds none due.
    due()
    prisma.$queryRaw.mockResolvedValue([] as never)

    const expired = await service.expireDue()

    expect(expired).toBe(1)
    expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', terminalReasonCode: 'approval_expired' }),
      })
    )
    // The latch hands the callback a guarded transaction facade (a Proxy), so inspect the call by hand
    // instead of letting the matcher enumerate it.
    const [event, options] = audit.record.mock.calls[0] as [Record<string, unknown>, object]
    expect(event).toMatchObject({ action: 'ai.approval.expired' })
    expect(Object.keys(options)).toEqual(['tx'])
    // Metric fires once, AFTER the item's transaction committed (post-commit).
    expect(metrics.incAiApproval).toHaveBeenCalledTimes(1)
    expect(metrics.incAiApproval).toHaveBeenCalledWith('tool_invocation', 'expired')
  })

  it('uses the deadline branch (EXPIRED/SKIPPED) when the run deadline has passed', async () => {
    due(new Date(Date.now() - 1000))
    prisma.$queryRaw.mockResolvedValue([] as never)

    await service.expireDue()

    expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'EXPIRED',
          terminalReasonCode: 'deadline_exceeded',
        }),
      })
    )
    expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SKIPPED' } })
    )
  })

  it('stops immediately when nothing is due (no metric, no writes)', async () => {
    prisma.$queryRaw.mockResolvedValue([] as never)
    const expired = await service.expireDue()
    expect(expired).toBe(0)
    expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
    expect(metrics.incAiApproval).not.toHaveBeenCalled()
  })

  it('locks the RUN before the approval, and leaves a busy run for the next tick (no writes)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'appr-1', runId: 'run-1' }] as never) // candidate (unlocked)
      .mockResolvedValueOnce([] as never) // run SKIP LOCKED: busy with decide/cancel/takeover/guard

    const expired = await service.expireDue()

    expect(expired).toBe(0)
    const sql = prisma.$queryRaw.mock.calls.map((call) =>
      (call[0] as { strings: string[] }).strings.join('')
    )
    expect(sql[1]).toContain('"ai"."ai_runs"')
    expect(sql[1]).toContain('FOR UPDATE SKIP LOCKED')
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2) // never reached the approval lock
    expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
    expect(metrics.incAiApproval).not.toHaveBeenCalled()
  })

  it('starts nothing once the dispatcher latch is closed', async () => {
    latch.close()

    await expect(service.sweep()).resolves.toBeUndefined()
    expect(await service.expireDue()).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('sweep swallows an error and never rejects (the next tick retries)', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'))
    await expect(service.sweep()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ai.approval.expiry_failed' }),
      expect.any(String)
    )
  })
})
