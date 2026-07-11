import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { BadRequestException, NotFoundException } from '../../../common/exceptions'

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
  let service: AiConversationOperatorService

  const takenOver = { id: 'conv-1', controlledBy: 'human' }
  const released = { id: 'conv-1', controlledBy: 'bot' }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    control = {
      takeControl: jest.fn().mockResolvedValue(takenOver),
      releaseControl: jest.fn().mockResolvedValue(released),
    }
    const env = { get: jest.fn(() => STEP_UP_WINDOW) } as unknown as EnvService
    const logger = { setContext: jest.fn() } as unknown as PinoLogger
    service = new AiConversationOperatorService(
      prisma,
      env,
      control as unknown as AiConversationControlService,
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
})
