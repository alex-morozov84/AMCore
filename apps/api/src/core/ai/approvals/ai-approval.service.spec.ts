import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { demoSensitiveTool } from '../../../../test/fixtures/demo-sensitive.tool'
import { FixtureToolAuthority } from '../../../../test/fixtures/extension-contracts/tool-registration'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../../common/exceptions'

import { AiApprovalService } from './ai-approval.service'

import type { AuditLogService } from '@/core/audit'
import { AiToolContractRegistry } from '@/infrastructure/ai/tools/ai-tool-contract.registry'
import { prepareToolIntent, toolIntentData } from '@/infrastructure/ai/tools/ai-tool-intent'
import type { MetricsService } from '@/infrastructure/observability'
import type { QueueService } from '@/infrastructure/queue/queue.service'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the owner approval decision service (Track C — ADR-054, Arc E.5b). Focus: the
 * freshness-gated, owner-scoped decision transaction — ownership 404, duplicate idempotent 200,
 * conflict 409, stale approval inline-expired to 409 (never re-queued), and a fresh approve/reject
 * that flips the gate + re-queues the run (attemptCount-decrementing) with an in-tx audit + a
 * post-commit wake.
 */

const OWNER = 'u1'
let intentHash: string

function lockRow(over: Record<string, unknown> = {}) {
  return {
    id: 'appr-1',
    state: 'PENDING',
    expiresAt: new Date(Date.now() + 3_600_000),
    runId: 'run-1',
    runStatus: 'WAITING_APPROVAL',
    deadlineAt: null,
    attemptCount: 1,
    ownerUserId: OWNER,
    conversationId: 'conv-1',
    organizationId: null,
    intentHash,
    now: new Date(),
    ...over,
  }
}

const projected = {
  id: 'appr-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  kind: 'tool_invocation',
  state: 'approved',
  toolId: 'danger',
  riskClass: 'sensitive',
  requestedReason: null,
  expiresAt: null,
  decidedAt: null,
  createdAt: new Date(0),
}

describe('AiApprovalService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: { record: jest.Mock }
  let metrics: { incAiApproval: jest.Mock }
  let queue: { add: jest.Mock }
  let service: AiApprovalService
  let authority: FixtureToolAuthority
  const logger = { setContext: jest.fn(), warn: jest.fn() }

  beforeEach(async () => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaService>()
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    // Default: every CAS matches exactly one row (the all-or-nothing multi-CAS invariant holds).
    prisma.aiApproval.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiApproval.findUniqueOrThrow.mockResolvedValue({
      ...projected,
      kind: 'TOOL_INVOCATION',
      state: 'APPROVED',
      createdAt: new Date(0),
      expiresAt: null,
      decidedAt: null,
      toolInvocations: [{ toolId: 'danger', riskClass: 'SENSITIVE' }],
    } as never)
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    metrics = { incAiApproval: jest.fn() }
    queue = { add: jest.fn().mockResolvedValue(undefined) }
    const tool = { ...demoSensitiveTool, toolId: 'danger' }
    authority = new FixtureToolAuthority()
    const contracts = new AiToolContractRegistry([tool], [authority])
    const prepared = await prepareToolIntent(
      tool,
      {},
      {
        runId: 'run-1',
        conversationId: 'conv-1',
        invocationId: 'invocation1',
        ownerUserId: OWNER,
        organizationId: null,
        idempotencyKey: 'ai-tool:invocation1',
      },
      prisma as never,
      1,
      contracts
    )
    intentHash = prepared.hash
    const action = {
      ...toolIntentData(prepared),
      toolId: tool.toolId,
      riskClass: tool.riskClass,
      originCall: 1,
      idempotency: tool.idempotency,
    }
    prisma.aiToolInvocation.findMany.mockResolvedValue([action] as never)
    prisma.aiConversation.findUnique.mockResolvedValue({
      assistant: { toolAllowlist: ['danger'] },
    } as never)
    prisma.aiApproval.findUniqueOrThrow.mockResolvedValue({
      ...projected,
      intentHash,
      kind: 'TOOL_INVOCATION',
      state: 'APPROVED',
      toolInvocations: [action],
    } as never)
    service = new AiApprovalService(
      prisma,
      audit as unknown as AuditLogService,
      metrics as unknown as MetricsService,
      queue as unknown as QueueService,
      logger as never,
      contracts
    )
  })

  function withLock(row: Record<string, unknown> | null): void {
    prisma.$queryRaw.mockResolvedValue((row === null ? [] : [row]) as never)
  }

  describe('decide — happy path', () => {
    it('approves: flips approval + invocation, re-queues the run (no retry budget spent), audits in-tx, wakes', async () => {
      withLock(lockRow())
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)

      const res = await service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })

      expect(res.state).toBe('approved')
      expect(prisma.aiApproval.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appr-1', state: 'PENDING' },
          data: expect.objectContaining({ state: 'APPROVED', decidedById: OWNER }),
        })
      )
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', status: 'WAITING_APPROVAL' },
          data: expect.objectContaining({ status: 'QUEUED' }),
        })
      )
      // A resume neither spends nor refunds retry budget: the counter is never touched.
      expect(prisma.aiRun.updateMany.mock.calls[0]![0]!.data).not.toHaveProperty('attemptCount')
      expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { approvalId: 'appr-1', status: 'AWAITING_APPROVAL' },
          data: { status: 'APPROVED' },
        })
      )
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.approval.approved' }),
        { tx: prisma }
      )
      expect(metrics.incAiApproval).toHaveBeenCalledWith('tool_invocation', 'approved')
      expect(queue.add).toHaveBeenCalledTimes(1)
    })

    it('does NOT decrement attemptCount when the (broken-invariant) count is 0', async () => {
      withLock(lockRow({ attemptCount: 0 }))
      await service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      const runUpdate = prisma.aiRun.updateMany.mock.calls[0]![0] as {
        data: Record<string, unknown>
      }
      expect(runUpdate.data.status).toBe('QUEUED')
      expect(runUpdate.data.attemptCount).toBeUndefined()
    })

    it('rejects: writes the reject audit and wakes the run', async () => {
      withLock(lockRow())
      await service.decide(OWNER, 'appr-1', { decision: 'reject', intentHash })
      expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REJECTED' } })
      )
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.approval.rejected' }),
        { tx: prisma }
      )
      expect(metrics.incAiApproval).toHaveBeenCalledWith('tool_invocation', 'rejected')
    })
  })

  describe('decide — 404 / idempotent / conflict', () => {
    it('404s a missing approval', async () => {
      withLock(null)
      await expect(
        service.decide(OWNER, 'x', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s an approval owned by another user (no existence leak)', async () => {
      withLock(lockRow({ ownerUserId: 'someone-else' }))
      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
    })

    it('is idempotent (200) when the same decision was already recorded', async () => {
      withLock(lockRow({ state: 'APPROVED' }))
      const res = await service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      expect(res.id).toBe('appr-1')
      expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
      expect(queue.add).not.toHaveBeenCalled()
    })

    it('409s a conflicting second decision (reject after approve)', async () => {
      withLock(lockRow({ state: 'APPROVED' }))
      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'reject', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
    })

    it('409s when the run is no longer awaiting approval (raced away)', async () => {
      withLock(lockRow({ runStatus: 'CANCELLED' }))
      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
    })
  })

  describe('decide — multi-CAS all-or-nothing (A2-R2 #1)', () => {
    it('rolls back (409, no wake/metric/audit) when the invocation flip matches 0 rows', async () => {
      withLock(lockRow())
      prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)

      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
      // The audit is written only AFTER all three counts pass, so a rolled-back decision commits none.
      expect(audit.record).not.toHaveBeenCalled()
      expect(queue.add).not.toHaveBeenCalled()
      expect(metrics.incAiApproval).not.toHaveBeenCalled()
    })

    it('rolls back (409, no wake/metric/audit) when the run re-queue matches 0 rows', async () => {
      withLock(lockRow())
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)

      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(audit.record).not.toHaveBeenCalled()
      expect(queue.add).not.toHaveBeenCalled()
      expect(metrics.incAiApproval).not.toHaveBeenCalled()
    })
  })

  describe('decide — freshness gate (A2-R1 #1)', () => {
    it('inline-expires a TTL-elapsed approval to FAILED(approval_expired) and 409s, never re-queuing', async () => {
      withLock(lockRow({ expiresAt: new Date(Date.now() - 1000), deadlineAt: null }))

      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
      // Approval EXPIRED, run FAILED(approval_expired), invocation REJECTED — no QUEUED transition.
      expect(prisma.aiApproval.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { state: 'EXPIRED' } })
      )
      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            terminalReasonCode: 'approval_expired',
          }),
        })
      )
      expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REJECTED' } })
      )
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.approval.expired' }),
        { tx: prisma }
      )
      expect(metrics.incAiApproval).toHaveBeenCalledWith('tool_invocation', 'expired')
      expect(queue.add).not.toHaveBeenCalled()
    })

    it('inline-expires a deadline-passed approval to EXPIRED(deadline_exceeded) + SKIPPED invocation', async () => {
      withLock(lockRow({ deadlineAt: new Date(Date.now() - 1000) }))

      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
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

    it('rolls back the inline-expire (409, no expiry audit/metric) when the run raced out of WAITING (A2-R2 #2)', async () => {
      withLock(lockRow({ expiresAt: new Date(Date.now() - 1000) }))
      prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never) // run already terminal

      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(audit.record).not.toHaveBeenCalled()
      expect(metrics.incAiApproval).not.toHaveBeenCalled()
    })
  })

  describe('immutable action decision binding', () => {
    it('checks the hash before returning an idempotent duplicate', async () => {
      withLock(lockRow({ state: 'APPROVED' }))
      await expect(
        service.decide(OWNER, 'appr-1', {
          decision: 'approve',
          intentHash: '0'.repeat(64),
        })
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
      expect(queue.add).not.toHaveBeenCalled()
    })

    it('refuses new approval after current read rights are revoked', async () => {
      withLock(lockRow())
      jest.spyOn(authority, 'canDisclose').mockResolvedValue(false)
      await expect(
        service.decide(OWNER, 'appr-1', { decision: 'approve', intentHash })
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(prisma.aiApproval.updateMany).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    })

    it('allows rejection after domain revoke without disclosing the stored preview', async () => {
      withLock(lockRow())
      jest.spyOn(authority, 'canDisclose').mockResolvedValue(false)
      const response = await service.decide(OWNER, 'appr-1', { decision: 'reject', intentHash })
      expect(response.preview).toBeNull()
      expect(response.disclosure).toBe('unavailable')
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.approval.rejected' }),
        { tx: prisma }
      )
    })

    it('rejects extra fields and a missing hash before acquiring locks', async () => {
      for (const input of [
        { decision: 'approve' },
        { decision: 'approve', intentHash, extra: true },
      ]) {
        await expect(service.decide(OWNER, 'appr-1', input as never)).rejects.toThrow()
      }
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('scopes to the owner and maps to the content-free wire projection', async () => {
      prisma.aiApproval.findMany.mockResolvedValue([
        {
          id: 'appr-1',
          runId: 'run-1',
          conversationId: 'conv-1',
          kind: 'TOOL_INVOCATION',
          state: 'PENDING',
          requestedReason: null,
          expiresAt: null,
          decidedAt: null,
          createdAt: new Date(0),
          toolInvocations: [{ toolId: 'danger', riskClass: 'SENSITIVE' }],
        },
      ] as never)

      const res = await service.list(OWNER, { status: 'pending' })

      expect(prisma.aiApproval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            run: { conversation: { ownerUserId: OWNER } },
            state: 'PENDING',
          }),
        })
      )
      expect(res.data[0]).toEqual(
        expect.objectContaining({
          id: 'appr-1',
          toolId: 'danger',
          riskClass: 'sensitive',
          state: 'pending',
        })
      )
    })
  })
})
