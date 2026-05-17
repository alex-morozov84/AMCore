import type { OrgMember, Role, User } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import {
  BusinessRuleViolationException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions'
import type { PrismaService } from '../../prisma'
import { EmailIdentityService } from '../auth/email-identity.service'

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
    emailCanonical: 'invited@example.com',
    emailVerified: false,
    passwordHash: null,
    name: null,
    avatarUrl: null,
    phone: null,
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
      orgsService as unknown as OrganizationsService,
      new EmailIdentityService()
    )
    // After OA-05 the invite() and assignRole() flows execute their
    // real work inside $transaction (the role-ownership check, the
    // membership / role-link write, and the conflict lookup for
    // assignRole). Tests need the callback to actually run so they
    // exercise that code. Delegating tx to the same prisma mock keeps
    // the existing per-call mocks reusable inside the callback.
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
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
      // assertRoleAssignable inside the tx → role.findUnique returns
      // a system role, allowed.
      prisma.role.findUnique.mockResolvedValue(mockMemberRole)
      prisma.orgMember.create.mockResolvedValue(mockMember)

      const result = await service.invite('org-1', dto, principal)

      expect(result).toEqual(mockMember)
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: 'invited@example.com' },
      })
      expect(prisma.$transaction).toHaveBeenCalled()
      expect(orgsService.bumpAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('looks up invited user by canonical email', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.role.findFirst.mockResolvedValue(mockMemberRole)
      prisma.role.findUnique.mockResolvedValue(mockMemberRole)
      prisma.orgMember.create.mockResolvedValue(mockMember)

      await service.invite(
        'org-1',
        { email: ' Invited@Example.COM ' } as InviteMemberDto,
        principal
      )

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: 'invited@example.com' },
      })
    })

    it('uses MEMBER system role when no roleId provided', async () => {
      const dtoNoRole: InviteMemberDto = { email: 'invited@example.com' } as InviteMemberDto
      prisma.user.findUnique.mockResolvedValue(mockUser)
      prisma.orgMember.findUnique.mockResolvedValue(null)
      prisma.role.findFirst.mockResolvedValue(mockMemberRole)
      prisma.role.findUnique.mockResolvedValue(mockMemberRole)
      prisma.orgMember.create.mockResolvedValue(mockMember)

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

    // OA-05: role-ownership invariant. Three reject paths must all
    // produce the same 403 + message so an attacker can't enumerate
    // roleIds across orgs by status code or response shape.
    describe('OA-05: role ownership', () => {
      const foreignCustomRole: Role = {
        id: 'role-from-org-b',
        name: 'Editor',
        description: null,
        isSystem: false,
        organizationId: 'org-b',
      }
      const sameOrgCustomRole: Role = {
        id: 'role-from-org-1',
        name: 'Editor',
        description: null,
        isSystem: false,
        organizationId: 'org-1',
      }

      it('rejects invite with foreign-org custom roleId → 403', async () => {
        prisma.user.findUnique.mockResolvedValue(mockUser)
        prisma.orgMember.findUnique.mockResolvedValue(null)
        prisma.role.findUnique.mockResolvedValue(foreignCustomRole)

        await expect(
          service.invite(
            'org-1',
            { email: 'invited@example.com', roleId: 'role-from-org-b' } as InviteMemberDto,
            principal
          )
        ).rejects.toThrow(ForbiddenException)
        // Defense-in-depth: write must NOT happen on the rejection path.
        expect(prisma.orgMember.create).not.toHaveBeenCalled()
        expect(prisma.memberRole.create).not.toHaveBeenCalled()
      })

      it('rejects invite with non-existent roleId → 403 (same message — no roleId enumeration)', async () => {
        prisma.user.findUnique.mockResolvedValue(mockUser)
        prisma.orgMember.findUnique.mockResolvedValue(null)
        prisma.role.findUnique.mockResolvedValue(null)

        await expect(
          service.invite(
            'org-1',
            { email: 'invited@example.com', roleId: 'role-nonexistent' } as InviteMemberDto,
            principal
          )
        ).rejects.toThrow(ForbiddenException)
        expect(prisma.orgMember.create).not.toHaveBeenCalled()
        expect(prisma.memberRole.create).not.toHaveBeenCalled()
      })

      it('accepts invite with same-org custom roleId', async () => {
        prisma.user.findUnique.mockResolvedValue(mockUser)
        prisma.orgMember.findUnique.mockResolvedValue(null)
        prisma.role.findUnique.mockResolvedValue(sameOrgCustomRole)
        prisma.orgMember.create.mockResolvedValue(mockMember)

        await expect(
          service.invite(
            'org-1',
            { email: 'invited@example.com', roleId: 'role-from-org-1' } as InviteMemberDto,
            principal
          )
        ).resolves.toEqual(mockMember)
      })
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
    const viewerRole: Role = {
      id: 'role-viewer',
      name: 'VIEWER',
      description: null,
      isSystem: true,
      organizationId: null,
    }

    it('assigns role and bumps aclVersion', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findUnique.mockResolvedValue(viewerRole)
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
      prisma.role.findUnique.mockResolvedValue(viewerRole)
      prisma.memberRole.findUnique.mockResolvedValue({
        id: 'mr-1',
        memberId: 'member-1',
        roleId: 'role-viewer',
      })

      await expect(service.assignRole('org-1', 'user-2', 'role-viewer', principal)).rejects.toThrow(
        ConflictException
      )
    })

    // OA-05: same role-ownership invariant applies to assignRole. The
    // 403 must NOT depend on whether the member already has the role
    // — role-ownership must fire before the alreadyAssigned conflict
    // check (otherwise ConflictException could leak that the foreign
    // roleId is currently assigned).
    describe('OA-05: role ownership', () => {
      const foreignCustomRole: Role = {
        id: 'role-from-org-b',
        name: 'Editor',
        description: null,
        isSystem: false,
        organizationId: 'org-b',
      }

      it('rejects assignRole with foreign-org custom roleId → 403', async () => {
        prisma.orgMember.findUnique.mockResolvedValue(mockMember)
        prisma.role.findUnique.mockResolvedValue(foreignCustomRole)

        await expect(
          service.assignRole('org-1', 'user-2', 'role-from-org-b', principal)
        ).rejects.toThrow(ForbiddenException)
        expect(prisma.memberRole.create).not.toHaveBeenCalled()
      })

      it('rejects assignRole with non-existent roleId → 403 (same message — no roleId enumeration)', async () => {
        prisma.orgMember.findUnique.mockResolvedValue(mockMember)
        prisma.role.findUnique.mockResolvedValue(null)

        await expect(
          service.assignRole('org-1', 'user-2', 'role-nonexistent', principal)
        ).rejects.toThrow(ForbiddenException)
        expect(prisma.memberRole.create).not.toHaveBeenCalled()
      })

      it('rejects foreign-org roleId even when alreadyAssigned lookup would resolve (role-ownership fires first)', async () => {
        prisma.orgMember.findUnique.mockResolvedValue(mockMember)
        prisma.role.findUnique.mockResolvedValue(foreignCustomRole)
        // Pretend the foreign role IS already in MemberRole (data
        // corruption from a pre-fix era). Role-ownership must still
        // reject; ConflictException must NOT be returned, because
        // that would confirm the foreign roleId is "assigned here".
        prisma.memberRole.findUnique.mockResolvedValue({
          id: 'mr-1',
          memberId: 'member-1',
          roleId: 'role-from-org-b',
        })

        await expect(
          service.assignRole('org-1', 'user-2', 'role-from-org-b', principal)
        ).rejects.toThrow(ForbiddenException)
      })
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
