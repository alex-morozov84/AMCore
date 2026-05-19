import type { OrgMember, Role } from '@prisma/client'
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

import { MemberService } from './member.service'
import type { OrganizationsService } from './organizations.service'
import { RoleAssignabilityService } from './role-assignability.service'

describe('MemberService', () => {
  let service: MemberService
  let prisma: DeepMockProxy<PrismaClient>
  let orgsService: jest.Mocked<
    Pick<OrganizationsService, 'bumpAclVersion' | 'bumpAclVersionTx' | 'invalidateAclVersion'>
  >

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
    orgsService = {
      bumpAclVersion: jest.fn().mockResolvedValue(undefined),
      bumpAclVersionTx: jest.fn().mockResolvedValue(undefined),
      invalidateAclVersion: jest.fn().mockResolvedValue(undefined),
    }
    service = new MemberService(
      prisma as unknown as PrismaService,
      orgsService as unknown as OrganizationsService,
      new RoleAssignabilityService()
    )
    // After OA-05 the assignRole() flow executes its real work inside
    // $transaction (the role-ownership check, the conflict lookup, and
    // the role-link write). Tests need the callback to actually run so
    // they exercise that code. Delegating tx to the same prisma mock
    // keeps the existing per-call mocks reusable inside the callback.
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
    )
    prisma.$executeRaw.mockResolvedValue(0 as never)
  })

  describe('removeMember', () => {
    it('removes member and bumps aclVersion', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole)
      prisma.memberRole.findMany.mockResolvedValue([]) // not an admin
      prisma.orgMember.delete.mockResolvedValue(mockMember)

      await service.removeMember('org-1', 'user-2', principal)

      expect(prisma.orgMember.delete).toHaveBeenCalledWith({ where: { id: mockMember.id } })
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx.mock.calls[0]?.[0]).toBe('org-1')
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
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

    /**
     * OA-09 companion: under Postgres READ COMMITTED, two concurrent
     * removeMember calls would both see two admins and both succeed.
     * The per-org advisory lock serializes them. Lock must fire
     * *before* any state read inside the transaction, otherwise the
     * lock buys nothing.
     */
    describe('OA-09 companion: advisory lock + tx-aware reads', () => {
      it('acquires per-org advisory lock inside the transaction before reads', async () => {
        prisma.orgMember.findUnique.mockResolvedValue(mockMember)
        prisma.role.findFirst.mockResolvedValue(mockAdminRole)
        prisma.memberRole.findMany.mockResolvedValue([])
        prisma.orgMember.delete.mockResolvedValue(mockMember)

        await service.removeMember('org-1', 'user-2', principal)

        const txOrder = (prisma.$transaction as unknown as jest.Mock).mock.invocationCallOrder[0]
        const lockOrder = prisma.$executeRaw.mock.invocationCallOrder[0]
        const memberReadOrder = prisma.orgMember.findUnique.mock.invocationCallOrder[0]
        const adminCountOrder = prisma.memberRole.findMany.mock.invocationCallOrder[0]
        const deleteOrder = prisma.orgMember.delete.mock.invocationCallOrder[0]

        expect(txOrder).toBeDefined()
        expect(lockOrder).toBeDefined()
        expect(memberReadOrder).toBeDefined()
        expect(adminCountOrder).toBeDefined()
        expect(deleteOrder).toBeDefined()
        // tx opens first, lock immediately inside, then reads, then write.
        expect(txOrder!).toBeLessThan(lockOrder!)
        expect(lockOrder!).toBeLessThan(memberReadOrder!)
        expect(memberReadOrder!).toBeLessThan(adminCountOrder!)
        expect(adminCountOrder!).toBeLessThan(deleteOrder!)
      })
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
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx.mock.calls[0]?.[0]).toBe('org-1')
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
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
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx.mock.calls[0]?.[0]).toBe('org-1')
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws BusinessRuleViolationException when removing last admin role', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole) // ADMIN id = 'role-admin'
      prisma.memberRole.findMany.mockResolvedValue([{ member: { userId: 'user-2' } }] as never) // only 1 admin, it's the target

      await expect(service.removeRole('org-1', 'user-2', 'role-admin', principal)).rejects.toThrow(
        BusinessRuleViolationException
      )
    })

    /**
     * OA-09 companion: removeRole must run member read, system-role
     * lookup, and last-admin assertion through the transaction client,
     * not `this.prisma` — that's how the advisory lock binds the
     * subsequent delete to a stable snapshot.
     */
    it('acquires advisory lock before reads and runs member read inside the transaction', async () => {
      prisma.orgMember.findUnique.mockResolvedValue(mockMember)
      prisma.role.findFirst.mockResolvedValue(mockAdminRole)
      prisma.memberRole.deleteMany.mockResolvedValue({ count: 1 })

      await service.removeRole('org-1', 'user-2', 'role-viewer', principal)

      const txOrder = (prisma.$transaction as unknown as jest.Mock).mock.invocationCallOrder[0]
      const lockOrder = prisma.$executeRaw.mock.invocationCallOrder[0]
      const memberReadOrder = prisma.orgMember.findUnique.mock.invocationCallOrder[0]
      const adminRoleLookupOrder = prisma.role.findFirst.mock.invocationCallOrder[0]
      const deleteOrder = prisma.memberRole.deleteMany.mock.invocationCallOrder[0]

      expect(txOrder).toBeDefined()
      expect(lockOrder).toBeDefined()
      expect(memberReadOrder).toBeDefined()
      expect(adminRoleLookupOrder).toBeDefined()
      expect(deleteOrder).toBeDefined()
      expect(txOrder!).toBeLessThan(lockOrder!)
      expect(lockOrder!).toBeLessThan(memberReadOrder!)
      expect(memberReadOrder!).toBeLessThan(adminRoleLookupOrder!)
      expect(adminRoleLookupOrder!).toBeLessThan(deleteOrder!)
    })
  })
})
