import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { ConflictException, NotFoundException } from '../../../common/exceptions'
import type { AuditLogService } from '../../audit'

import { AiConversationControlService, type ControlActor } from './ai-conversation-control.service'

import type { MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

const owner: ControlActor = { userId: 'owner-1', isSuperAdmin: false }
const operator: ControlActor = { userId: 'admin-9', isSuperAdmin: true }

interface LockedRow {
  ownerUserId: string
  state: string
  controlledBy: string
  ownershipGeneration: number
  humanControlUserId: string | null
}

function locked(over: Partial<LockedRow> = {}): LockedRow {
  return {
    ownerUserId: 'owner-1',
    state: 'ACTIVE',
    controlledBy: 'BOT',
    ownershipGeneration: 0,
    humanControlUserId: null,
    ...over,
  }
}

function convRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-07-11T00:00:00.000Z')
  return {
    id: 'conv-1',
    ownerUserId: 'owner-1',
    organizationId: null,
    assistantId: null,
    title: null,
    state: 'PAUSED_FOR_HUMAN',
    controlledBy: 'HUMAN',
    ownershipGeneration: 1,
    humanControlUserId: 'owner-1',
    humanControlAcquiredAt: now,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...over,
  }
}

describe('AiConversationControlService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: { record: jest.Mock }
  let metrics: { incAiConversationControl: jest.Mock }
  let service: AiConversationControlService

  /**
   * `$queryRaw` is used twice on a proceeding take: (1) the conversation `FOR UPDATE` lock, then
   * (2) the approval-driven `FOR UPDATE OF a, r` lock. Sequence the two so the first returns the
   * conversation row and the second the pending-approval pairs (empty by default / for release).
   */
  function setConversation(row: LockedRow, approvalPairs: unknown[] = []): void {
    ;(prisma.$queryRaw as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([row])
      .mockResolvedValue(approvalPairs)
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      (cb: (tx: unknown) => unknown) => cb(prisma)
    )
    prisma.aiRun.updateMany.mockResolvedValue({ count: 0 } as never)
    prisma.aiApproval.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.aiConversation.update.mockResolvedValue(convRow() as never)
    prisma.aiConversation.findUniqueOrThrow.mockResolvedValue(convRow() as never)
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    metrics = { incAiConversationControl: jest.fn() }
    const logger = { setContext: jest.fn(), info: jest.fn() } as unknown as PinoLogger
    service = new AiConversationControlService(
      prisma,
      audit as unknown as AuditLogService,
      metrics as unknown as MetricsService,
      logger
    )
    setConversation(locked())
  })

  describe('takeControl', () => {
    it('takes a BOT conversation → HUMAN/PAUSED, bumps generation, records the owner holder', async () => {
      const result = await service.takeControl(owner, 'conv-1', 'SUP-1')

      expect(prisma.aiConversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: expect.objectContaining({
            controlledBy: 'HUMAN',
            state: 'PAUSED_FOR_HUMAN',
            ownershipGeneration: 1,
            humanControlUserId: 'owner-1',
          }),
        })
      )
      expect(result.controlledBy).toBe('human')
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ai.conversation.taken_over',
          targetType: 'AI_CONVERSATION',
          metadata: expect.objectContaining({ actorRole: 'owner', reasonRef: 'SUP-1' }),
        }),
        { tx: prisma }
      )
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('taken_over', 'owner')
    })

    it('voids WAITING_APPROVAL runs under the approval-driven FOR UPDATE lock, with a per-approval audit', async () => {
      setConversation(locked({ controlledBy: 'BOT' }), [{ approvalId: 'appr-1', runId: 'run-7' }])
      // First aiRun.updateMany = the WAITING_APPROVAL void; second = the QUEUED sweep (none here).
      prisma.aiRun.updateMany
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValue({ count: 0 } as never)

      await service.takeControl(owner, 'conv-1')

      // The second $queryRaw is the approval-driven lock — assert the FOR UPDATE OF a, r path exists.
      const voidQuery = (prisma.$queryRaw as unknown as jest.Mock).mock.calls[1]![0]
      expect((voidQuery.strings as string[]).join('')).toContain('FOR UPDATE OF a, r')

      expect(prisma.aiRun.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: 'run-7', status: 'WAITING_APPROVAL' },
          data: expect.objectContaining({ terminalReasonCode: 'superseded_by_human' }),
        })
      )
      expect(prisma.aiApproval.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appr-1', state: 'PENDING' },
          data: { state: 'EXPIRED' },
        })
      )
      expect(prisma.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { approvalId: 'appr-1', status: 'AWAITING_APPROVAL' },
          data: { status: 'SKIPPED' },
        })
      )
      // Per-approval security audit + the aggregate takeover event, both in-tx.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ai.approval.expired',
          metadata: expect.objectContaining({
            approvalId: 'appr-1',
            runId: 'run-7',
            reasonCode: 'superseded_by_human',
          }),
        }),
        { tx: prisma }
      )
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ai.conversation.taken_over',
          metadata: expect.objectContaining({ supersededRuns: 1, voidedApprovals: 1 }),
        }),
        { tx: prisma }
      )
    })

    it('rolls the takeover back (409) when a voided approval CAS races away', async () => {
      setConversation(locked({ controlledBy: 'BOT' }), [{ approvalId: 'appr-1', runId: 'run-7' }])
      prisma.aiRun.updateMany.mockResolvedValue({ count: 1 } as never)
      prisma.aiApproval.updateMany.mockResolvedValue({ count: 0 } as never) // raced away

      await expect(service.takeControl(owner, 'conv-1')).rejects.toThrow(ConflictException)
    })

    it('sweeps QUEUED runs (superseded_by_human) after voiding WAITING_APPROVAL', async () => {
      setConversation(locked({ controlledBy: 'BOT' }))
      prisma.aiRun.updateMany.mockResolvedValue({ count: 3 } as never)

      await service.takeControl(owner, 'conv-1')

      expect(prisma.aiRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conv-1', status: 'QUEUED' },
          data: expect.objectContaining({
            status: 'CANCELLED',
            terminalReasonCode: 'superseded_by_human',
          }),
        })
      )
    })

    it('is an idempotent no-op when the same holder re-takes (no generation bump, no audit/metric)', async () => {
      setConversation(locked({ controlledBy: 'HUMAN', humanControlUserId: 'owner-1' }))

      await service.takeControl(owner, 'conv-1')

      expect(prisma.aiConversation.update).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
      expect(metrics.incAiConversationControl).not.toHaveBeenCalled()
    })

    it('lets an operator take a BOT conversation cross-user (operator role)', async () => {
      await service.takeControl(operator, 'conv-1')
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('taken_over', 'operator')
    })

    it('409s when an operator tries to take a conversation another human already holds', async () => {
      setConversation(locked({ controlledBy: 'HUMAN', humanControlUserId: 'someone-else' }))

      await expect(service.takeControl(operator, 'conv-1')).rejects.toThrow(ConflictException)
      expect(prisma.aiConversation.update).not.toHaveBeenCalled()
    })

    it('lets the owner reclaim their own conversation from an operator holder', async () => {
      setConversation(locked({ controlledBy: 'HUMAN', humanControlUserId: 'admin-9' }))

      await service.takeControl(owner, 'conv-1')

      expect(prisma.aiConversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ humanControlUserId: 'owner-1' }),
        })
      )
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('taken_over', 'owner')
    })

    it('409s on a closed conversation', async () => {
      setConversation(locked({ state: 'CLOSED' }))
      await expect(service.takeControl(owner, 'conv-1')).rejects.toThrow(ConflictException)
    })

    it('404s for a missing conversation (no existence leak)', async () => {
      ;(prisma.$queryRaw as unknown as jest.Mock).mockReset().mockResolvedValue([])
      await expect(service.takeControl(owner, 'conv-1')).rejects.toThrow(NotFoundException)
    })

    it('404s when the actor is neither the owner nor a SUPER_ADMIN (no existence leak)', async () => {
      setConversation(locked({ ownerUserId: 'someone-else' }))
      await expect(
        service.takeControl({ userId: 'stranger', isSuperAdmin: false }, 'conv-1')
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('releaseControl', () => {
    it('releases a held conversation → BOT/ACTIVE, clears the holder, bumps generation', async () => {
      setConversation(
        locked({ controlledBy: 'HUMAN', humanControlUserId: 'owner-1', ownershipGeneration: 1 })
      )
      prisma.aiConversation.update.mockResolvedValue(
        convRow({ controlledBy: 'BOT', state: 'ACTIVE', ownershipGeneration: 2 }) as never
      )

      const result = await service.releaseControl(owner, 'conv-1')

      expect(prisma.aiConversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            controlledBy: 'BOT',
            state: 'ACTIVE',
            ownershipGeneration: 2,
            humanControlUserId: null,
            humanControlAcquiredAt: null,
          }),
        })
      )
      expect(result.controlledBy).toBe('bot')
      expect(prisma.aiRun.updateMany).not.toHaveBeenCalled() // no runs to supersede on release
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('released', 'owner')
    })

    it('is an idempotent no-op when the conversation is already BOT-controlled', async () => {
      setConversation(locked({ controlledBy: 'BOT' }))
      await service.releaseControl(owner, 'conv-1')
      expect(prisma.aiConversation.update).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    })

    it('409s when a non-holder operator tries to release', async () => {
      setConversation(locked({ controlledBy: 'HUMAN', humanControlUserId: 'someone-else' }))
      await expect(service.releaseControl(operator, 'conv-1')).rejects.toThrow(ConflictException)
    })

    it('lets the owner force-release their own conversation held by an operator', async () => {
      setConversation(locked({ controlledBy: 'HUMAN', humanControlUserId: 'admin-9' }))
      prisma.aiConversation.update.mockResolvedValue(
        convRow({ controlledBy: 'BOT', state: 'ACTIVE' }) as never
      )
      await service.releaseControl(owner, 'conv-1')
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('released', 'owner')
    })
  })
})
