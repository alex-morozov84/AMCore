import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../../../common/exceptions'

import { AiConversationAccessAuthorizer } from './ai-conversation-access.authorizer'
import type { AiConversationControlService } from './ai-conversation-control.service'
import { AiConversationOperatorService } from './ai-conversation-operator.service'

import type { EnvService } from '@/env/env.service'
import type { PrismaService } from '@/prisma'

const STEP_UP_WINDOW = 300

const ownerPrincipal = {
  type: 'jwt',
  sub: 'owner-1',
  systemRole: SystemRole.User,
  sid: 'sess-owner',
} as RequestPrincipal

const operatorPrincipal = {
  type: 'jwt',
  sub: 'admin-9',
  systemRole: SystemRole.SuperAdmin,
  sid: 'sess-admin',
} as RequestPrincipal

/** A fresh (recently re-authenticated) session row for the given user. */
function freshSession(userId: string): Record<string, unknown> {
  return {
    lastAuthAt: new Date(Date.now() - 10_000), // 10s ago, well within the 300s window
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    userId,
  }
}

describe('AiConversationOperatorService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let control: { takeControl: jest.Mock; releaseControl: jest.Mock }
  let audit: { record: jest.Mock }
  let metrics: { incAiConversationControl: jest.Mock }
  let service: AiConversationOperatorService

  const takenOver = { id: 'conv-1', controlledBy: 'human' }
  const released = { id: 'conv-1', controlledBy: 'bot' }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      (cb: (tx: unknown) => unknown) => cb(prisma)
    )
    control = {
      takeControl: jest.fn().mockResolvedValue(takenOver),
      releaseControl: jest.fn().mockResolvedValue(released),
    }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    metrics = { incAiConversationControl: jest.fn() }
    const env = { get: jest.fn(() => STEP_UP_WINDOW) } as unknown as EnvService
    const logger = { setContext: jest.fn(), info: jest.fn() } as unknown as PinoLogger
    // The real authorizer over the SAME mocked prisma/env: the extraction (Arc G) is
    // behavior-preserving, so every access/step-up/reason expectation below stays green unchanged.
    const authorizer = new AiConversationAccessAuthorizer(prisma, env)
    service = new AiConversationOperatorService(
      prisma,
      authorizer,
      control as unknown as AiConversationControlService,
      audit as unknown as import('../../audit').AuditLogService,
      metrics as unknown as import('@/infrastructure/observability').MetricsService,
      logger
    )
  })

  describe('access (no-leak)', () => {
    it('404s when the conversation does not exist', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue(null as never)
      await expect(service.takeover(ownerPrincipal, 'gone')).rejects.toThrow(NotFoundException)
      expect(control.takeControl).not.toHaveBeenCalled()
    })

    it('404s when the actor is neither the owner nor a SUPER_ADMIN (no existence leak)', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'someone-else' } as never)
      await expect(service.takeover(ownerPrincipal, 'conv-1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('owner self-action (no step-up, no reason)', () => {
    it('takes over without a reason and without a session read', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)

      const result = await service.takeover(ownerPrincipal, 'conv-1')

      expect(control.takeControl).toHaveBeenCalledWith(
        { userId: 'owner-1', isSuperAdmin: false },
        'conv-1',
        undefined
      )
      expect(prisma.session.findUnique).not.toHaveBeenCalled() // no step-up check for the owner
      expect(result).toBe(takenOver)
    })

    it('releases without a reason', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      const result = await service.release(ownerPrincipal, 'conv-1')
      expect(control.releaseControl).toHaveBeenCalledWith(
        { userId: 'owner-1', isSuperAdmin: false },
        'conv-1',
        undefined
      )
      expect(result).toBe(released)
    })

    it('still validates a reason the owner DOES supply (400 on a control-char value)', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      const withNewline = `note${String.fromCharCode(10)}here`

      await expect(service.takeover(ownerPrincipal, 'conv-1', withNewline)).rejects.toThrow(
        BadRequestException
      )
      expect(control.takeControl).not.toHaveBeenCalled()
    })
  })

  describe('cross-user SUPER_ADMIN operator (step-up + reason required)', () => {
    beforeEach(() => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
    })

    it('takes over with a fresh session + a reason, passing the TRIMMED reason to the primitive', async () => {
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)

      await service.takeover(operatorPrincipal, 'conv-1', '  SUP-42  ')

      expect(prisma.session.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sess-admin' } })
      )
      expect(control.takeControl).toHaveBeenCalledWith(
        { userId: 'admin-9', isSuperAdmin: true },
        'conv-1',
        'SUP-42' // trimmed
      )
    })

    it('400s when the cross-user operator omits the reason', async () => {
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)

      await expect(service.takeover(operatorPrincipal, 'conv-1')).rejects.toThrow(
        BadRequestException
      )
      expect(control.takeControl).not.toHaveBeenCalled()
    })

    it('400s for an empty / whitespace-only reason (does not survive as a valid ticket ref)', async () => {
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)

      await expect(service.takeover(operatorPrincipal, 'conv-1', '   ')).rejects.toThrow(
        BadRequestException
      )
      expect(control.takeControl).not.toHaveBeenCalled()
    })

    it('400s for a reason with control characters (audit sanitizer would drop it)', async () => {
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
      const withTab = `SUP${String.fromCharCode(9)}42`

      await expect(service.takeover(operatorPrincipal, 'conv-1', withTab)).rejects.toThrow(
        BadRequestException
      )
      expect(control.takeControl).not.toHaveBeenCalled()
    })

    it('403 (step-up) when the operator session is stale — before any control mutation', async () => {
      prisma.session.findUnique.mockResolvedValue({
        lastAuthAt: new Date(Date.now() - 10_000_000), // far outside the window
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        userId: 'admin-9',
      } as never)

      await expect(service.takeover(operatorPrincipal, 'conv-1', 'SUP-42')).rejects.toMatchObject({
        errorCode: 'STEP_UP_REQUIRED',
      })
      expect(control.takeControl).not.toHaveBeenCalled()
    })

    it('403 (step-up) when the operator has no session at all', async () => {
      prisma.session.findUnique.mockResolvedValue(null as never)
      await expect(service.release(operatorPrincipal, 'conv-1', 'SUP-42')).rejects.toMatchObject({
        errorCode: 'STEP_UP_REQUIRED',
      })
      expect(control.releaseControl).not.toHaveBeenCalled()
    })
  })

  describe('getTranscript', () => {
    const msg = (sequence: number): Record<string, unknown> => ({
      id: `msg-${sequence}`,
      conversationId: 'conv-1',
      runId: null,
      sequence,
      role: 'USER',
      authorType: 'USER',
      content: [{ type: 'text', text: 'hi' }],
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
    })

    it('owner reads without an access audit; paginates by sequence with a nextCursor', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      // limit 2 → fetch 3, hasMore true, nextCursor = last returned sequence.
      prisma.aiMessage.findMany.mockResolvedValue([msg(0), msg(1), msg(2)] as never)

      const result = await service.getTranscript(ownerPrincipal, 'conv-1', { limit: 2 })

      expect(result.data).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('1')
      expect(audit.record).not.toHaveBeenCalled() // owner read is not audited
    })

    it('cross-user operator read is step-up + reason gated and AUDITED (content-free)', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
      prisma.aiMessage.findMany.mockResolvedValue([msg(0)] as never)

      await service.getTranscript(operatorPrincipal, 'conv-1', { limit: 20 }, 'SUP-9')

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ai.conversation.transcript_accessed',
          targetType: 'AI_CONVERSATION',
          metadata: expect.objectContaining({ actorRole: 'operator', reasonRef: 'SUP-9' }),
        }),
        // Strict, fail-closed: the read is not served until the access is durably recorded.
        { failOpen: false }
      )
      // The audit metadata never carries message content.
      const meta = audit.record.mock.calls[0]![0].metadata as Record<string, unknown>
      expect(JSON.stringify(meta)).not.toContain('hi')
    })

    it('does not return the transcript when the fail-closed access audit rejects (cross-user)', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
      prisma.aiMessage.findMany.mockResolvedValue([msg(0)] as never)
      audit.record.mockRejectedValue(new Error('audit sink down'))

      // getTranscript awaits the strict audit before returning — a rejection propagates, so the
      // caller never receives the transcript. (Paired with the AuditLogService spec proving the
      // strict `failOpen:false` path actually throws on a real DB-write failure.)
      await expect(
        service.getTranscript(operatorPrincipal, 'conv-1', { limit: 20 }, 'SUP-9')
      ).rejects.toThrow('audit sink down')
    })

    it('403 for a cross-user read with a stale session (no transcript served)', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.session.findUnique.mockResolvedValue(null as never)

      await expect(
        service.getTranscript(operatorPrincipal, 'conv-1', { limit: 20 }, 'SUP-9')
      ).rejects.toMatchObject({ errorCode: 'STEP_UP_REQUIRED' })
      expect(prisma.aiMessage.findMany).not.toHaveBeenCalled()
    })
  })

  describe('postMessage', () => {
    const created = {
      id: 'msg-3',
      conversationId: 'conv-1',
      runId: null,
      sequence: 3,
      role: 'ASSISTANT',
      authorType: 'OPERATOR',
      content: [{ type: 'text', text: 'reply' }],
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
    }
    const input = { content: [{ type: 'text' as const, text: 'reply' }], reason: 'SUP-1' }

    beforeEach(() => {
      prisma.aiMessage.aggregate.mockResolvedValue({ _max: { sequence: 2 } } as never)
      prisma.aiMessage.create.mockResolvedValue(created as never)
    })

    it('lets the holding owner post a USER-authored ASSISTANT turn + in-tx audit', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.$queryRaw.mockResolvedValue([
        { ownerUserId: 'owner-1', controlledBy: 'HUMAN', humanControlUserId: 'owner-1' },
      ] as never)

      await service.postMessage(ownerPrincipal, 'conv-1', { content: input.content })

      expect(prisma.aiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'ASSISTANT',
            authorType: 'USER',
            authorUserId: 'owner-1',
          }),
        })
      )
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.conversation.operator_message' }),
        { tx: prisma }
      )
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('operator_message', 'owner')
    })

    it('lets the holding operator post an OPERATOR-authored turn', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
      prisma.$queryRaw.mockResolvedValue([
        { ownerUserId: 'owner-1', controlledBy: 'HUMAN', humanControlUserId: 'admin-9' },
      ] as never)

      await service.postMessage(operatorPrincipal, 'conv-1', input)

      expect(prisma.aiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ authorType: 'OPERATOR', authorUserId: 'admin-9' }),
        })
      )
      expect(metrics.incAiConversationControl).toHaveBeenCalledWith('operator_message', 'operator')
    })

    it('409s when the actor does not currently hold control (must take over first)', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.$queryRaw.mockResolvedValue([
        { ownerUserId: 'owner-1', controlledBy: 'BOT', humanControlUserId: null },
      ] as never)

      await expect(
        service.postMessage(ownerPrincipal, 'conv-1', { content: input.content })
      ).rejects.toThrow(ConflictException)
      expect(prisma.aiMessage.create).not.toHaveBeenCalled()
    })

    it('409s when a different human holds control', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
      prisma.$queryRaw.mockResolvedValue([
        { ownerUserId: 'owner-1', controlledBy: 'HUMAN', humanControlUserId: 'someone-else' },
      ] as never)

      await expect(
        service.postMessage(ownerPrincipal, 'conv-1', { content: input.content })
      ).rejects.toThrow(ConflictException)
    })
  })
})
