import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { BusinessRuleViolationException, NotFoundException } from '../../common/exceptions'
import type { CleanupService } from '../../infrastructure/schedule/cleanup.service'
import type { PrismaService } from '../../prisma'
import type { AuditLogService } from '../audit'

import { AdminService } from './admin.service'

import type { Organization, User } from '@/generated/prisma/client'
import type { PrismaClient } from '@/generated/prisma/client'

describe('AdminService', () => {
  let service: AdminService
  let prisma: DeepMockProxy<PrismaClient>
  let cleanupService: jest.Mocked<Pick<CleanupService, 'runCleanup'>>
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>
  let logger: jest.Mocked<PinoLogger>

  const createdAt = new Date('2026-05-01T10:00:00.000Z')
  const updatedAt = new Date('2026-05-02T10:00:00.000Z')
  const lastLoginAt = new Date('2026-05-03T10:00:00.000Z')

  const mockUser: User = {
    id: 'user-1',
    email: 'user@example.com',
    emailCanonical: 'user@example.com',
    emailVerified: false,
    passwordHash: 'argon2-hash-should-never-leak',
    name: 'Test User',
    avatarUrl: null,
    avatarGeneration: 0,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    systemRole: 'USER',
    createdAt,
    updatedAt,
    lastLoginAt,
  }

  const mockOrg: Organization = {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme',
    aclVersion: 7,
    createdAt,
    updatedAt,
  }

  const actor: RequestPrincipal = {
    type: 'jwt',
    sub: 'actor-sa',
    systemRole: SystemRole.SuperAdmin,
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    cleanupService = { runCleanup: jest.fn() }
    auditLog = { record: jest.fn().mockResolvedValue(undefined) }
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    service = new AdminService(
      prisma as unknown as PrismaService,
      cleanupService as unknown as CleanupService,
      auditLog as unknown as AuditLogService,
      logger
    )
    // Delegate $transaction callbacks to the same prisma mock so test
    // mocks set on the outer prisma instance (findUnique, count,
    // update, $executeRaw) are observable from inside the callback.
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
    )
    prisma.$executeRaw.mockResolvedValue(0 as never)
    // OB-06a: updateUserSystemRole revokes the target's sessions on any
    // role change; default the post-commit deleteMany so role-change tests
    // that don't assert on it still resolve cleanly.
    prisma.session.deleteMany.mockResolvedValue({ count: 0 } as never)
  })

  describe('findAllUsers', () => {
    it('returns paginated users with page/limit envelope', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser])
      prisma.user.count.mockResolvedValue(1)

      const result = await service.findAllUsers(1, 20)

      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.data).toHaveLength(1)
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 })
      )
    })

    it('calculates correct skip for page 2', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      const result = await service.findAllUsers(2, 10)

      expect(result.page).toBe(2)
      expect(result.limit).toBe(10)
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      )
    })

    /**
     * OA-07: defense-in-depth at the data layer. `select` allowlist
     * guarantees Postgres never reads `passwordHash` /
     * `emailCanonical`, regardless of what the mapper does downstream.
     */
    it('queries Prisma with the ADMIN_USER_SELECT allowlist', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      await service.findAllUsers(1, 20)

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
      const arg = prisma.user.findMany.mock.calls[0]![0]!
      expect(arg.select).toBeDefined()
      expect(arg.select).not.toHaveProperty('passwordHash')
      expect(arg.select).not.toHaveProperty('emailCanonical')
      expect(arg.select).toMatchObject({
        id: true,
        email: true,
        systemRole: true,
        createdAt: true,
        updatedAt: true,
      })
    })

    /**
     * OA-07: even if a future contributor accidentally removes
     * `select`, the mapper still strips the result to schema fields.
     * Asserts the wire shape never contains `passwordHash`.
     */
    it('returns shape without passwordHash / emailCanonical and with ISO-string dates', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser])
      prisma.user.count.mockResolvedValue(1)

      const result = await service.findAllUsers(1, 20)
      expect(result.data).toHaveLength(1)
      const user = result.data[0]!

      expect(user).not.toHaveProperty('passwordHash')
      expect(user).not.toHaveProperty('emailCanonical')
      expect(typeof user.createdAt).toBe('string')
      expect(typeof user.updatedAt).toBe('string')
      expect(user.createdAt).toBe(createdAt.toISOString())
      expect(user.updatedAt).toBe(updatedAt.toISOString())
      expect(user.lastLoginAt).toBe(lastLoginAt.toISOString())
    })
  })

  describe('updateUserSystemRole', () => {
    it('updates system role when user exists', async () => {
      const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
      const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
      prisma.user.findUnique.mockResolvedValue(target)
      prisma.user.update.mockResolvedValue(updated)

      const result = await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)

      expect(result.systemRole).toBe('SUPER_ADMIN')
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { systemRole: SystemRole.SuperAdmin },
        })
      )
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.user.system_role_changed',
          actorId: actor.sub,
          targetId: 'user-1',
        }),
        expect.objectContaining({ tx: prisma })
      )
    })

    it('fails closed when transactional audit insert fails', async () => {
      const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
      const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
      prisma.user.findUnique.mockResolvedValue(target)
      prisma.user.update.mockResolvedValue(updated)
      auditLog.record.mockRejectedValueOnce(new Error('audit down'))

      await expect(
        service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)
      ).rejects.toThrow('audit down')
      expect(prisma.session.deleteMany).not.toHaveBeenCalled()
    })

    /** OA-07: update also uses ADMIN_USER_SELECT and returns sanitized shape. */
    it('queries Prisma update with the ADMIN_USER_SELECT allowlist', async () => {
      const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
      const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
      prisma.user.findUnique.mockResolvedValue(target)
      prisma.user.update.mockResolvedValue(updated)

      const result = await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)

      expect(prisma.user.update).toHaveBeenCalledTimes(1)
      const arg = prisma.user.update.mock.calls[0]![0]!
      expect(arg.select).toBeDefined()
      expect(arg.select).not.toHaveProperty('passwordHash')
      expect(arg.select).not.toHaveProperty('emailCanonical')
      expect(result).not.toHaveProperty('passwordHash')
      expect(result).not.toHaveProperty('emailCanonical')
      expect(typeof result.createdAt).toBe('string')
    })

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(
        service.updateUserSystemRole('nonexistent', SystemRole.SuperAdmin, actor)
      ).rejects.toThrow(NotFoundException)
    })

    /**
     * OA-09: self-demotion is rejected purely based on the request
     * principal (no DB read needed at this gate). `prisma.user.update`
     * must never be reached. We allow the gate to perform DB reads
     * later for uniformity if implementation chooses to, but the
     * write must not happen.
     */
    describe('OA-09 last-admin guard + audit', () => {
      it('rejects self-demotion before update', async () => {
        await expect(
          service.updateUserSystemRole(actor.sub, SystemRole.User, {
            ...actor,
            sub: actor.sub,
          })
        ).rejects.toThrow(BusinessRuleViolationException)
        expect(prisma.user.update).not.toHaveBeenCalled()
      })

      it('rejects last-SUPER_ADMIN demotion (non-self target)', async () => {
        const target: User = { ...mockUser, id: 'sa-target', systemRole: 'SUPER_ADMIN' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.count.mockResolvedValue(0)

        await expect(
          service.updateUserSystemRole('sa-target', SystemRole.User, actor)
        ).rejects.toThrow(BusinessRuleViolationException)
        expect(prisma.user.update).not.toHaveBeenCalled()
        expect(prisma.user.count).toHaveBeenCalledWith({
          where: { systemRole: SystemRole.SuperAdmin, id: { not: 'sa-target' } },
        })
      })

      it('allows SUPER_ADMIN demotion when another SUPER_ADMIN exists', async () => {
        const target: User = { ...mockUser, id: 'sa-target', systemRole: 'SUPER_ADMIN' }
        const updated: User = { ...target, systemRole: 'USER' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.count.mockResolvedValue(1)
        prisma.user.update.mockResolvedValue(updated)

        const result = await service.updateUserSystemRole('sa-target', SystemRole.User, actor)

        expect(result.systemRole).toBe('USER')
        expect(prisma.user.update).toHaveBeenCalledTimes(1)
      })

      it('no-op (before === requested) skips update and audit', async () => {
        const target: User = { ...mockUser, id: 'user-x', systemRole: 'USER' }
        prisma.user.findUnique.mockResolvedValue(target)

        await service.updateUserSystemRole('user-x', SystemRole.User, actor)

        expect(prisma.user.update).not.toHaveBeenCalled()
        const auditCalls = logger.info.mock.calls.filter(
          (c) => (c[0] as { event?: string }).event === 'auth.admin.system_role_changed'
        )
        expect(auditCalls).toHaveLength(0)
      })

      it('acquires advisory lock before findUnique and update inside the transaction', async () => {
        const target: User = { ...mockUser, id: 'sa-target', systemRole: 'SUPER_ADMIN' }
        const updated: User = { ...target, systemRole: 'USER' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.count.mockResolvedValue(1)
        prisma.user.update.mockResolvedValue(updated)

        await service.updateUserSystemRole('sa-target', SystemRole.User, actor)

        const lockOrder = prisma.$executeRaw.mock.invocationCallOrder[0]
        const findOrder = prisma.user.findUnique.mock.invocationCallOrder[0]
        const updateOrder = prisma.user.update.mock.invocationCallOrder[0]
        expect(lockOrder).toBeDefined()
        expect(findOrder).toBeDefined()
        expect(updateOrder).toBeDefined()
        expect(lockOrder!).toBeLessThan(findOrder!)
        expect(findOrder!).toBeLessThan(updateOrder!)
      })

      it('emits audit log after successful role change', async () => {
        const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
        const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.update.mockResolvedValue(updated)

        await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)

        expect(logger.info).toHaveBeenCalledWith(
          {
            event: 'auth.admin.system_role_changed',
            actorUserId: actor.sub,
            targetUserId: 'user-1',
            beforeSystemRole: 'USER',
            afterSystemRole: 'SUPER_ADMIN',
          },
          'Admin changed user system role'
        )
      })
    })

    /**
     * OB-06a / ADR-037 (amendment 2026-05-30): a committed system-role change
     * revokes the target's sessions on ANY `before !== after` change
     * (demotion + promotion), best-effort, post-commit. No-op does not revoke.
     */
    describe('OB-06a session revocation', () => {
      it('revokes target sessions after a promotion (any before !== after)', async () => {
        const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
        const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.update.mockResolvedValue(updated)
        prisma.session.deleteMany.mockResolvedValue({ count: 3 } as never)

        await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)

        expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
        expect(logger.info).toHaveBeenCalledWith(
          {
            event: 'auth.admin.sessions_revoked',
            actorUserId: actor.sub,
            targetUserId: 'user-1',
            count: 3,
          },
          'Revoked target sessions after system-role change'
        )
      })

      it('revokes target sessions after a demotion', async () => {
        const target: User = { ...mockUser, id: 'sa-target', systemRole: 'SUPER_ADMIN' }
        const updated: User = { ...target, systemRole: 'USER' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.count.mockResolvedValue(1)
        prisma.user.update.mockResolvedValue(updated)
        prisma.session.deleteMany.mockResolvedValue({ count: 2 } as never)

        await service.updateUserSystemRole('sa-target', SystemRole.User, actor)

        expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'sa-target' } })
      })

      it('does not revoke on a no-op (before === after)', async () => {
        const target: User = { ...mockUser, id: 'user-x', systemRole: 'USER' }
        prisma.user.findUnique.mockResolvedValue(target)

        await service.updateUserSystemRole('user-x', SystemRole.User, actor)

        expect(prisma.session.deleteMany).not.toHaveBeenCalled()
      })

      it('swallows a revocation failure: role change still succeeds, warn emitted', async () => {
        const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
        const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.update.mockResolvedValue(updated)
        prisma.session.deleteMany.mockRejectedValue(new Error('redis/db down'))

        const result = await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)

        expect(result.systemRole).toBe('SUPER_ADMIN')
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'auth.admin.session_revoke_failed',
            actorUserId: actor.sub,
            targetUserId: 'user-1',
          }),
          'Failed to revoke target sessions after system-role change'
        )
      })

      it('revocation log carries only actor/target CUIDs + count — no token material', async () => {
        const target: User = { ...mockUser, id: 'user-1', systemRole: 'USER' }
        const updated: User = { ...target, systemRole: 'SUPER_ADMIN' }
        prisma.user.findUnique.mockResolvedValue(target)
        prisma.user.update.mockResolvedValue(updated)
        prisma.session.deleteMany.mockResolvedValue({ count: 1 } as never)

        await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin, actor)

        const revokeLog = logger.info.mock.calls.find(
          (c) => (c[0] as { event?: string }).event === 'auth.admin.sessions_revoked'
        )
        expect(revokeLog).toBeDefined()
        const payload = revokeLog![0] as Record<string, unknown>
        expect(Object.keys(payload).sort()).toEqual([
          'actorUserId',
          'count',
          'event',
          'targetUserId',
        ])
      })
    })
  })

  describe('runCleanup', () => {
    it('delegates to CleanupService, returns result, emits audit log', async () => {
      const mockResult = {
        expiredSessions: 5,
        expiredPasswordResetTokens: 3,
        expiredEmailVerificationTokens: 7,
        expiredApiKeys: 0,
        expiredPendingInvites: 2,
        staleTerminalInvites: 1,
        failures: [],
      }
      cleanupService.runCleanup.mockResolvedValue(mockResult)

      const result = await service.runCleanup(actor)

      expect(result).toEqual(mockResult)
      expect(cleanupService.runCleanup).toHaveBeenCalled()
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.cleanup.executed',
          actorId: actor.sub,
        })
      )
      expect(logger.info).toHaveBeenCalledWith(
        {
          event: 'auth.admin.cleanup_executed',
          actorUserId: actor.sub,
          counts: mockResult,
        },
        'Admin triggered cleanup'
      )
    })

    it('does not emit audit when cleanup throws', async () => {
      cleanupService.runCleanup.mockRejectedValue(new Error('cleanup failed'))

      await expect(service.runCleanup(actor)).rejects.toThrow('cleanup failed')
      expect(auditLog.record).not.toHaveBeenCalled()
      const auditCalls = logger.info.mock.calls.filter(
        (c) => (c[0] as { event?: string }).event === 'auth.admin.cleanup_executed'
      )
      expect(auditCalls).toHaveLength(0)
    })
  })

  describe('findAllOrganizations', () => {
    it('returns paginated organizations with page/limit envelope', async () => {
      prisma.organization.findMany.mockResolvedValue([mockOrg])
      prisma.organization.count.mockResolvedValue(1)

      const result = await service.findAllOrganizations(1, 20)

      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.data).toHaveLength(1)
    })

    /**
     * OA-08: organization reads use a `select` allowlist; `aclVersion`
     * (internal RBAC freshness counter, ADR-035) is not read from DB
     * and never leaks to the wire.
     */
    it('queries Prisma with the ADMIN_ORGANIZATION_SELECT allowlist (no aclVersion)', async () => {
      prisma.organization.findMany.mockResolvedValue([])
      prisma.organization.count.mockResolvedValue(0)

      await service.findAllOrganizations(1, 20)

      const arg = prisma.organization.findMany.mock.calls[0]![0]!
      expect(arg.select).toBeDefined()
      expect(arg.select).not.toHaveProperty('aclVersion')
      expect(arg.select).toMatchObject({
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      })
    })

    it('returns sanitized org shape with ISO-string dates and no aclVersion', async () => {
      prisma.organization.findMany.mockResolvedValue([mockOrg])
      prisma.organization.count.mockResolvedValue(1)

      const result = await service.findAllOrganizations(1, 20)
      expect(result.data).toHaveLength(1)
      const org = result.data[0]!

      expect(org).not.toHaveProperty('aclVersion')
      expect(typeof org.createdAt).toBe('string')
      expect(typeof org.updatedAt).toBe('string')
      expect(org.createdAt).toBe(createdAt.toISOString())
    })
  })
})
