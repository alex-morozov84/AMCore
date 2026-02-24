import { ForbiddenException } from '@nestjs/common'
import type { OrgMember, Role, User } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import {
  BusinessRuleViolationException,
  ConflictException,
  NotFoundException,
} from '../../common/exceptions'
import type { PrismaService } from '../../prisma'

import type { InviteMemberDto } from './dto'
import { MemberService } from './member.service'
import type { OrganizationsService } from './organizations.service'

describe('MemberService', () => {
  let service: MemberService
  let prisma: DeepMockProxy<PrismaClient>
  let orgsService: jest.Mocked<Pick<OrganizationsService, 'bumpAclVersion'>>

  const mockUser: User = {
    id: 'user-2',
    email: 'invited@example.com',
    emailVerified: false,
    passwordHash: null,
    name: null,
    avatarUrl: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    systemRole: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  }

  const mockMember: OrgMember = {
    id: 'member-1',
    userId: 'user-2',
    organizationId: 'org-1',
    createdAt: new Date(),
  }

  const mockAdminRole: Role = {
    id: 'role-admin',
    name: 'ADMIN',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const mockMemberRole: Role = {
    id: 'role-member',
    name: 'MEMBER',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-1',
    email: 'admin@example.com',
    systemRole: SystemRole.User,
    organizationId: 'org-1',
    aclVersion: 0,
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    orgsService = { bumpAclVersion: jest.fn().mockResolvedValue(undefined) }
    service = new MemberService(
      prisma as unknown as PrismaService,
      orgsService as unknown as OrganizationsService
    )
  })

  describe('invite', () => {
    const dto: InviteMemberDto = {
      email: 'invited@example.com',
      roleId: 'role-member',
    } as InviteMemberDto

    it('creates membership with specified role', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      ;(prisma.$transaction as jest.Mock).mockResolvedValue(mockMember)

      const result = await service.invite('org-1', dto, principal)

      expect(result).toEqual(mockMember)
      expect(prisma.$transaction).toHaveBeenCalled()
      expect(orgsService.bumpAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('uses MEMBER system role when no roleId provided', async () => {
      const dtoNoRole: InviteMemberDto = { email: 'invited@example.com' } as InviteMemberDto
      prisma.user.findUnique.mockResolvedValue(mockUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.role.findFirst.mockResolvedValue(mockMemberRole)
      ;(prisma.$transaction as jest.Mock).mockResolvedValue(mockMember)

      await service.invite('org-1', dtoNoRole, principal)

      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
        select: { id: true },
      })
    })

    it('throws ForbiddenException when org context mismatches', async () => {
      const wrongPrincipal = { ...principal, organizationId: 'org-other' }
      await expect(service.invite('org-1', dto, wrongPrincipal)).rejects.toThrow(ForbiddenException)
    })

    it('throws NotFoundException when invited email has no account', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      await expect(service.invite('org-1', dto, principal)).rejects.toThrow(NotFoundException)
    })

    it('throws ConflictException when user is already a member', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser)
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      await expect(service.invite('org-1', dto, principal)).rejects.toThrow(ConflictException)
    })
  })

  describe('removeMember', () => {
    it('removes member and bumps aclVersion', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole)
      prisma.memberRole.findMany.mockResolvedValue([]) // not an admin
      prisma.orgMember.delete.mockResolvedValue(mockMember)

      await service.removeMember('org-1', 'user-2', principal)

      expect(prisma.orgMember.delete).toHaveBeenCalledWith({ where: { id: mockMember.id } })
      expect(orgsService.bumpAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws NotFoundException when member not in org', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(null)
      await expect(service.removeMember('org-1', 'user-2', principal)).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws BusinessRuleViolationException when removing last admin', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole)
      prisma.memberRole.findMany.mockResolvedValue([{ member: { userId: 'user-2' } }] as never) // only 1 admin, and it's the target

      await expect(service.removeMember('org-1', 'user-2', principal)).rejects.toThrow(
        BusinessRuleViolationException
      )
    })
  })

  describe('assignRole', () => {
    it('assigns role and bumps aclVersion', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.memberRole.findUnique.mockResolvedValue(null)
      prisma.memberRole.create.mockResolvedValue({
        id: 'mr-1',
        memberId: 'member-1',
        roleId: 'role-viewer',
      })

      await service.assignRole('org-1', 'user-2', 'role-viewer', principal)

      expect(prisma.memberRole.create).toHaveBeenCalled()
      expect(orgsService.bumpAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws NotFoundException when member not in org', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(null)
      await expect(service.assignRole('org-1', 'user-2', 'role-viewer', principal)).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws ConflictException when member already has role', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.memberRole.findUnique.mockResolvedValue({
        id: 'mr-1',
        memberId: 'member-1',
        roleId: 'role-viewer',
      })

      await expect(service.assignRole('org-1', 'user-2', 'role-viewer', principal)).rejects.toThrow(
        ConflictException
      )
    })
  })

  describe('removeRole', () => {
    it('removes non-admin role without last-admin check', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole) // ADMIN role id = 'role-admin'
      prisma.memberRole.deleteMany.mockResolvedValue({ count: 1 })

      await service.removeRole('org-1', 'user-2', 'role-viewer', principal) // not admin role

      expect(prisma.memberRole.deleteMany).toHaveBeenCalled()
      expect(orgsService.bumpAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws BusinessRuleViolationException when removing last admin role', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole) // ADMIN id = 'role-admin'
      prisma.memberRole.findMany.mockResolvedValue([{ member: { userId: 'user-2' } }] as never) // only 1 admin, it's the target

      await expect(service.removeRole('org-1', 'user-2', 'role-admin', principal)).rejects.toThrow(
        BusinessRuleViolationException
      )
    })
  })
})
