import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { RequestPrincipal } from '@amcore/shared'

import { BusinessRuleViolationException, NotFoundException } from '../../common/exceptions'
import type { GeoIpService } from '../../infrastructure/geoip/geoip.service'
import type { PrismaService } from '../../prisma'
import type { AuditLogService } from '../audit'

import { AdminSessionsService } from './admin-sessions.service'

import type { PrismaClient, Session } from '@/generated/prisma/client'

describe('AdminSessionsService', () => {
  let service: AdminSessionsService
  let prisma: DeepMockProxy<PrismaClient>
  let geoIp: jest.Mocked<Pick<GeoIpService, 'resolve'>>
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>
  let logger: jest.Mocked<PinoLogger>

  const actor: RequestPrincipal = { type: 'jwt', sub: 'actor-sa', systemRole: 'SUPER_ADMIN' }
  const targetUserId = 'user-target'

  const activeSession: Session = {
    id: 'row-1',
    userId: targetUserId,
    familyId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    refreshToken: 'hashed-token',
    userAgent: 'Chrome on macOS',
    ipAddress: '203.0.0.1',
    expiresAt: new Date('2026-10-03T09:10:00.000Z'),
    revokedAt: null,
    revocationReason: null,
    lastAuthAt: new Date('2026-09-24T14:02:00.000Z'),
    createdAt: new Date('2026-09-26T09:10:00.000Z'),
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    geoIp = { resolve: jest.fn().mockReturnValue(null) }
    auditLog = { record: jest.fn().mockResolvedValue(undefined) }
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    service = new AdminSessionsService(
      prisma as unknown as PrismaService,
      geoIp as unknown as GeoIpService,
      auditLog as unknown as AuditLogService,
      logger
    )

    // Delegate $transaction callbacks to the same prisma mock, as the
    // sibling AdminService spec does, so mocks set on the outer instance
    // are observable from inside the transaction callback.
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
    )
    prisma.$executeRaw.mockResolvedValue(0 as never)
    prisma.session.findMany.mockResolvedValue([])
  })

  describe('list', () => {
    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.list(targetUserId, { page: 1, limit: 20 }, 'en', actor)).rejects.toThrow(
        NotFoundException
      )
      expect(prisma.session.findMany).not.toHaveBeenCalled()
    })

    it('returns active sessions with resolved locations, distinct from an empty result', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: targetUserId } as never)
      prisma.$queryRaw.mockResolvedValue([{ rows: [activeSession], total: 1 }])
      geoIp.resolve.mockReturnValue({ city: 'Berlin', countryCode: 'DE' })

      const result = await service.list(targetUserId, { page: 1, limit: 20 }, 'en', actor)

      expect(prisma.$queryRaw).toHaveBeenCalled()
      expect(result.total).toBe(1)
      expect(result.data).toEqual([
        {
          sessionId: activeSession.familyId,
          userAgent: activeSession.userAgent,
          ipAddress: activeSession.ipAddress,
          location: { city: 'Berlin', countryCode: 'DE' },
          lastAuthAt: activeSession.lastAuthAt!.toISOString(),
          createdAt: activeSession.createdAt.toISOString(),
          expiresAt: activeSession.expiresAt.toISOString(),
        },
      ])
      expect(geoIp.resolve).toHaveBeenCalledWith(activeSession.ipAddress, 'en')
    })

    it('audits every successful read, including an empty page, with bounded metadata only', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: targetUserId } as never)
      prisma.$queryRaw.mockResolvedValue([{ rows: [], total: 0 }])

      const result = await service.list(targetUserId, { page: 1, limit: 20 }, 'en', actor)

      expect(result.data).toEqual([])
      expect(auditLog.record).toHaveBeenCalledWith({
        action: 'admin.user.sessions_viewed',
        actorId: actor.sub,
        actorType: 'USER',
        metadata: { page: 1, limit: 20, resultCount: 0 },
        targetId: targetUserId,
        targetType: 'USER',
      })
    })
  })

  describe('revokeOne', () => {
    it('rejects revoking the actor’s own sessions through this action', async () => {
      await expect(service.revokeOne(actor.sub, activeSession.familyId, actor)).rejects.toThrow(
        BusinessRuleViolationException
      )
      expect(prisma.session.findFirst).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when the family is absent or belongs to another user', async () => {
      prisma.session.findFirst.mockResolvedValue(null)

      await expect(service.revokeOne(targetUserId, activeSession.familyId, actor)).rejects.toThrow(
        NotFoundException
      )
      expect(prisma.session.updateMany).not.toHaveBeenCalled()
    })

    it('soft-revokes the matching family and audits the actual affected count', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: activeSession.id } as never)
      prisma.session.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.revokeOne(targetUserId, activeSession.familyId, actor)

      expect(prisma.$executeRaw).toHaveBeenCalled()
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: {
          userId: targetUserId,
          familyId: activeSession.familyId,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date), revocationReason: 'admin_revoked' },
      })
      expect(prisma.session.deleteMany).not.toHaveBeenCalled()
      expect(auditLog.record).toHaveBeenCalledWith(
        {
          action: 'admin.user.session_revoked',
          actorId: actor.sub,
          actorType: 'USER',
          metadata: { sessionId: activeSession.familyId, count: 1 },
          targetId: targetUserId,
          targetType: 'USER',
        },
        { tx: prisma }
      )
      expect(result).toEqual({ affected: 1 })
    })

    it('is idempotent — succeeds with affected: 0 when the family already exists but is inactive', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: activeSession.id } as never)
      prisma.session.updateMany.mockResolvedValue({ count: 0 })

      const result = await service.revokeOne(targetUserId, activeSession.familyId, actor)

      expect(result).toEqual({ affected: 0 })
      // Still audited — the family existed and a genuine admin action was attempted.
      expect(auditLog.record).toHaveBeenCalled()
    })
  })

  describe('revokeAll', () => {
    it('rejects revoking the actor’s own sessions through this action', async () => {
      await expect(service.revokeAll(actor.sub, actor)).rejects.toThrow(
        BusinessRuleViolationException
      )
      expect(prisma.session.updateMany).not.toHaveBeenCalled()
    })

    it('soft-revokes every active family and always audits, even with zero affected', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 0 })

      const result = await service.revokeAll(targetUserId, actor)

      expect(prisma.$executeRaw).toHaveBeenCalled()
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: {
          userId: targetUserId,
          familyId: { in: [] },
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date), revocationReason: 'admin_revoked' },
      })
      expect(prisma.session.deleteMany).not.toHaveBeenCalled()
      expect(auditLog.record).toHaveBeenCalledWith(
        {
          action: 'admin.user.sessions_revoked',
          actorId: actor.sub,
          actorType: 'USER',
          metadata: { count: 0, reason: 'admin_bulk_revoke' },
          targetId: targetUserId,
          targetType: 'USER',
        },
        { tx: prisma }
      )
      expect(result).toEqual({ affected: 0 })
    })

    it('reports the actual affected count when sessions were active', async () => {
      prisma.session.findMany.mockResolvedValue(
        ['a', 'b', 'c'].map((familyId) => ({ familyId })) as never
      )
      prisma.session.updateMany.mockResolvedValue({ count: 4 })

      const result = await service.revokeAll(targetUserId, actor)

      expect(result).toEqual({ affected: 3 })
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { count: 3, reason: 'admin_bulk_revoke' } }),
        { tx: prisma }
      )
    })
  })
})
