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

  const mockUser: User = {
    id: 'user-1',
    email: 'user@example.com',
    emailVerified: false,
    passwordHash: null,
    name: 'Test User',
    avatarUrl: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    systemRole: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
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

      expect(result).toEqual({ data: [mockUser], total: 1 })
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
  })

  describe('updateUserSystemRole', () => {
    it('updates system role when user exists', async () => {
      const updated: User = { ...mockUser, systemRole: 'SUPER_ADMIN' }
      prisma.user.findUnique.mockResolvedValue(mockUser)
      prisma.user.update.mockResolvedValue(updated)

      const result = await service.updateUserSystemRole('user-1', SystemRole.SuperAdmin)

      expect(result.systemRole).toBe('SUPER_ADMIN')
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { systemRole: SystemRole.SuperAdmin },
      })
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
