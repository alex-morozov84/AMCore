import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { BadRequestException, NotFoundException } from '../../../common/exceptions'

import { AiConversationAccessAuthorizer } from './ai-conversation-access.authorizer'

import type { EnvService } from '@/env/env.service'
import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the extracted shared conversation-access authorizer (Track C — ADR-054, Arc G).
 * The Arc F operator suite proves the extraction is behavior-preserving; these tests pin the
 * authorizer's own contract directly so both consumers (operator review + artifact download) rely
 * on a covered primitive.
 */

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

function freshSession(userId: string): Record<string, unknown> {
  return {
    lastAuthAt: new Date(Date.now() - 10_000),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    userId,
  }
}

describe('AiConversationAccessAuthorizer', () => {
  let prisma: DeepMockProxy<PrismaService>
  let authorizer: AiConversationAccessAuthorizer

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    const env = { get: jest.fn(() => STEP_UP_WINDOW) } as unknown as EnvService
    authorizer = new AiConversationAccessAuthorizer(prisma, env)
  })

  it('404s a missing conversation (no existence leak)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(null as never)
    await expect(authorizer.authorize(ownerPrincipal, 'gone', undefined)).rejects.toThrow(
      NotFoundException
    )
  })

  it('404s a non-owner, non-SUPER_ADMIN actor (no existence leak)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'someone-else' } as never)
    await expect(authorizer.authorize(ownerPrincipal, 'conv-1', undefined)).rejects.toThrow(
      NotFoundException
    )
  })

  it('authorizes the owner with no step-up and no reason (isCrossUser=false)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
    const result = await authorizer.authorize(ownerPrincipal, 'conv-1', undefined)
    expect(result).toEqual({
      actor: { userId: 'owner-1', isSuperAdmin: false },
      isCrossUser: false,
      reason: undefined,
    })
    expect(prisma.session.findUnique).not.toHaveBeenCalled()
  })

  it('requires step-up for a cross-user operator (403 before authorization completes)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
    prisma.session.findUnique.mockResolvedValue(null as never) // no fresh session
    await expect(
      authorizer.authorize(operatorPrincipal, 'conv-1', 'SUPPORT-1')
    ).rejects.toMatchObject({ errorCode: 'STEP_UP_REQUIRED' })
  })

  it('requires a reason for a cross-user operator (400 when omitted, even if fresh)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
    prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
    await expect(authorizer.authorize(operatorPrincipal, 'conv-1', undefined)).rejects.toThrow(
      BadRequestException
    )
  })

  it('rejects a reason that violates the bounded grammar (400)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
    prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
    // A control character is not allowed by the audit-aligned reason grammar.
    await expect(authorizer.authorize(operatorPrincipal, 'conv-1', 'bad\u0001ref')).rejects.toThrow(
      BadRequestException
    )
  })

  it('authorizes a fresh cross-user operator with a valid reason (isCrossUser=true)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'owner-1' } as never)
    prisma.session.findUnique.mockResolvedValue(freshSession('admin-9') as never)
    const result = await authorizer.authorize(operatorPrincipal, 'conv-1', 'SUPPORT-1234')
    expect(result).toEqual({
      actor: { userId: 'admin-9', isSuperAdmin: true },
      isCrossUser: true,
      reason: 'SUPPORT-1234',
    })
  })

  it('treats a SUPER_ADMIN acting on their OWN conversation as owner, not cross-user (no step-up)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue({ ownerUserId: 'admin-9' } as never)
    const result = await authorizer.authorize(operatorPrincipal, 'conv-1', undefined)
    expect(result.isCrossUser).toBe(false)
    expect(prisma.session.findUnique).not.toHaveBeenCalled()
  })
})
