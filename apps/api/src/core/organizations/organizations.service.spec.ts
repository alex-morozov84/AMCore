import { ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { Organization, OrgMember, Role } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../common/exceptions'
import type { PrismaService } from '../../prisma'

import { OrganizationsService } from './organizations.service'

describe('OrganizationsService', () => {
  let service: OrganizationsService
  let prisma: DeepMockProxy<PrismaClient>

  const mockOrg: Organization = {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    aclVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockRole: Role = {
    id: 'role-admin',
    name: 'ADMIN',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const mockMember: OrgMember = {
    id: 'member-1',
    userId: 'user-1',
    organizationId: 'org-1',
    createdAt: new Date(),
  }

  const mockPrincipal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-1',
    email: 'user@example.com',
    systemRole: SystemRole.User,
    organizationId: 'org-1',
    aclVersion: 0,
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new OrganizationsService(prisma as unknown as PrismaService)
  })

  describe('create', () => {
    it('creates org with auto-generated slug and assigns ADMIN role to creator', async () => {
      prisma.organization.findUnique.mockResolvedValue(null) // slug not taken
      prisma.role.findFirst.mockResolvedValue(mockRole)
      // $transaction is mocked to return the org — the callback is an implementation detail
      prisma.$transaction.mockResolvedValue(mockOrg)

      const result = await service.create('user-1', { name: 'Acme Corp' })

      expect(result).toEqual(mockOrg)
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'ADMIN', isSystem: true, organizationId: null },
      })
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('throws ConflictException when provided slug is already taken', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg) // slug taken

      await expect(service.create('user-1', { name: 'Acme', slug: 'acme-corp' })).rejects.toThrow(
        ConflictException
      )
    })

    it('throws InternalServerErrorException when system roles are not seeded', async () => {
      prisma.organization.findUnique.mockResolvedValue(null)
      prisma.role.findFirst.mockResolvedValue(null) // no ADMIN role

      await expect(service.create('user-1', { name: 'Acme Corp' })).rejects.toThrow(
        InternalServerErrorException
      )
    })
  })

  describe('findAllForUser', () => {
    it('returns organizations mapped from user memberships', async () => {
      prisma.orgMember.findMany.mockResolvedValue([
        { ...mockMember, organization: mockOrg } as OrgMember & { organization: Organization },
      ] as never)

      const result = await service.findAllForUser('user-1')

      expect(result).toEqual([mockOrg])
    })
  })

  describe('findOne', () => {
    it('returns org when user is a member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg)
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)

      const result = await service.findOne('org-1', 'user-1')
      expect(result).toEqual(mockOrg)
    })

    it('throws NotFoundException when org does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null)
      prisma.orgMember.findUnique.mockResolvedValue(null)

      await expect(service.findOne('org-1', 'user-1')).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException when user is not a member', async () => {
      prisma.organization.findUnique.mockResolvedValue(mockOrg)
      prisma.orgMember.findUnique.mockResolvedValue(null)

      await expect(service.findOne('org-1', 'user-1')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('update', () => {
    it('throws ForbiddenException when principal.organizationId does not match', async () => {
      const wrongPrincipal: RequestPrincipal = { ...mockPrincipal, organizationId: 'org-other' }

      await expect(service.update('org-1', wrongPrincipal, { name: 'New Name' })).rejects.toThrow(
        ForbiddenException
      )
    })

    it('updates org when caller is in the correct org context', async () => {
      prisma.organization.findFirst.mockResolvedValue(null) // no slug conflict
      prisma.organization.update.mockResolvedValue({ ...mockOrg, name: 'New Name' })

      const result = await service.update('org-1', mockPrincipal, { name: 'New Name' })
      expect(result.name).toBe('New Name')
    })
  })

  describe('remove', () => {
    it('throws ForbiddenException when principal.organizationId does not match', async () => {
      const wrongPrincipal: RequestPrincipal = { ...mockPrincipal, organizationId: undefined }
      await expect(service.remove('org-1', wrongPrincipal)).rejects.toThrow(ForbiddenException)
    })

    it('deletes org when caller is in the correct org context', async () => {
      prisma.organization.delete.mockResolvedValue(mockOrg)
      await expect(service.remove('org-1', mockPrincipal)).resolves.toBeUndefined()
    })
  })

  describe('getForSwitch', () => {
    it('throws ForbiddenException when user is not a member', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(null)
      await expect(service.getForSwitch('org-1', 'user-1')).rejects.toThrow(ForbiddenException)
    })

    it('returns aclVersion when user is a member', async () => {
      prisma.orgMember.findUnique.mockResolvedValue({
        ...mockMember,
        organization: { aclVersion: 5 },
      } as never)

      const result = await service.getForSwitch('org-1', 'user-1')
      expect(result).toEqual({ aclVersion: 5 })
    })
  })

  describe('bumpAclVersion', () => {
    it('increments aclVersion in the database', async () => {
      prisma.organization.update.mockResolvedValue({ ...mockOrg, aclVersion: 1 })
      await service.bumpAclVersion('org-1')
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { aclVersion: { increment: 1 } },
      })
    })
  })
})
