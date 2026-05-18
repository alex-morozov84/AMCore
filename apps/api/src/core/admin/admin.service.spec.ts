import type { Organization, User } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { SystemRole } from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions'
import type { CleanupService } from '../../infrastructure/schedule/cleanup.service'
import type { PrismaService } from '../../prisma'

import { AdminService } from './admin.service'

describe('AdminService', () => {
  let service: AdminService
  let prisma: DeepMockProxy<PrismaClient>
  let cleanupService: jest.Mocked<Pick<CleanupService, 'runCleanup'>>

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
    aclVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    cleanupService = { runCleanup: jest.fn() }
    service = new AdminService(
      prisma as unknown as PrismaService,
      cleanupService as unknown as CleanupService
    )
  })

  describe('findAllUsers', () => {
    it('returns paginated users with defaults', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser])
      prisma.user.count.mockResolvedValue(1)

      const result = await service.findAllUsers()

      expect(result.total).toBe(1)
      expect(result.data).toHaveLength(1)
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 })
      )
    })

    it('calculates correct skip for page 2', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      await service.findAllUsers(2, 10)

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      )
    })

    it('caps limit at MAX_LIMIT (100)', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      await service.findAllUsers(1, 999)

      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    })

    /**
     * OA-07: defense-in-depth at the data layer. `select` allowlist
     * guarantees Postgres never reads `passwordHash` /
     * `emailCanonical`, regardless of what the mapper does downstream.
     */
    it('queries Prisma with the ADMIN_USER_SELECT allowlist', async () => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)

      await service.findAllUsers()

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

      const result = await service.findAllUsers()
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
      const updated: User = { ...mockUser, systemRole: 'SUPER_ADMIN' }
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' } as User)
      prisma.user.update.mockResolvedValue(updated)

      const result = await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin)

      expect(result.systemRole).toBe('SUPER_ADMIN')
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { systemRole: SystemRole.SuperAdmin },
        })
      )
    })

    /** OA-07: update also uses ADMIN_USER_SELECT and returns sanitized shape. */
    it('queries Prisma update with the ADMIN_USER_SELECT allowlist', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' } as User)
      prisma.user.update.mockResolvedValue(mockUser)

      const result = await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin)

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
        service.updateUserSystemRole('nonexistent', SystemRole.SuperAdmin)
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('runCleanup', () => {
    it('delegates to CleanupService and returns result', async () => {
      const mockResult = {
        expiredSessions: 5,
        expiredPasswordResetTokens: 3,
        expiredEmailVerificationTokens: 7,
        expiredApiKeys: 0,
      }
      cleanupService.runCleanup.mockResolvedValue(mockResult)

      const result = await service.runCleanup()

      expect(result).toEqual(mockResult)
      expect(cleanupService.runCleanup).toHaveBeenCalled()
    })
  })

  describe('findAllOrganizations', () => {
    it('returns paginated organizations', async () => {
      prisma.organization.findMany.mockResolvedValue([mockOrg])
      prisma.organization.count.mockResolvedValue(1)

      const result = await service.findAllOrganizations()

      expect(result).toEqual({ data: [mockOrg], total: 1 })
    })

    it('caps limit at MAX_LIMIT (100)', async () => {
      prisma.organization.findMany.mockResolvedValue([])
      prisma.organization.count.mockResolvedValue(0)

      await service.findAllOrganizations(1, 500)

      expect(prisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      )
    })
  })
})
