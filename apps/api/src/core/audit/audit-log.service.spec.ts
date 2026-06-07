import { AuditActorType, AuditCategory, AuditTargetType } from '@prisma/client'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import { createMockContext, mockContextToPrisma } from '../auth/test-context'

import { AuditLogService } from './audit-log.service'

describe('AuditLogService', () => {
  const cls = {
    get: jest.fn((key: string) => ({ ip: '10.20.0.0', userId: 'cls-user' })[key]),
    getId: jest.fn(() => 'req-123'),
  } as unknown as jest.Mocked<ClsService>
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
  } as unknown as jest.Mocked<Pick<PinoLogger, 'setContext' | 'warn'>>

  afterEach(() => jest.clearAllMocks())

  it('writes a sanitized record enriched from CLS', async () => {
    const mockCtx = createMockContext()
    mockCtx.prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' } as never)
    const service = new AuditLogService(mockContextToPrisma(mockCtx), cls, logger as never)

    await service.record({
      action: 'org.invite_created',
      actorType: AuditActorType.USER,
      category: AuditCategory.SECURITY,
      metadata: {
        actorCredentialType: 'jwt',
        branch: 'pending_new_email',
        email: 'secret@example.com',
        emailHash: 'hash-1',
        password: 'never',
        pinoEvent: 'org.invite.created',
        roleId: 'role-1',
      },
      organizationId: 'org-1',
      targetId: 'invite-1',
      targetType: AuditTargetType.ORG_INVITE,
    })

    expect(mockCtx.prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(mockCtx.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'org.invite_created',
        actorId: 'cls-user',
        ip: '10.20.0.0',
        organizationId: 'org-1',
        requestId: 'req-123',
        targetId: 'invite-1',
        targetType: AuditTargetType.ORG_INVITE,
      }),
    })
    expect(mockCtx.prisma.auditLog.create.mock.calls[0]![0]!.data.metadata).toEqual({
      actorCredentialType: 'jwt',
      branch: 'pending_new_email',
      emailHash: 'hash-1',
      pinoEvent: 'org.invite.created',
      roleId: 'role-1',
    })
  })

  it('uses the provided transaction and lets the error propagate', async () => {
    const mockCtx = createMockContext()
    const tx = { auditLog: { create: jest.fn().mockRejectedValue(new Error('tx failed')) } }
    const service = new AuditLogService(mockContextToPrisma(mockCtx), cls, logger as never)

    await expect(
      service.record(
        { action: 'auth.step_up_succeeded', actorType: AuditActorType.SYSTEM, metadata: {} },
        { tx: tx as never }
      )
    ).rejects.toThrow('tx failed')

    expect(mockCtx.prisma.auditLog.create).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1)
  })
})
