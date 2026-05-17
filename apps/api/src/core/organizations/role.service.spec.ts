import type { Permission, Role } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import { ConflictException, ForbiddenException, NotFoundException } from '../../common/exceptions'
import type { PrismaService } from '../../prisma'

import type { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto'
import type { OrganizationsService } from './organizations.service'
import { RoleService } from './role.service'

describe('RoleService', () => {
  let service: RoleService
  let prisma: DeepMockProxy<PrismaClient>
  let orgsService: jest.Mocked<
    Pick<OrganizationsService, 'bumpAclVersion' | 'bumpAclVersionTx' | 'invalidateAclVersion'>
  >

  const mockCustomRole: Role = {
    id: 'role-custom',
    name: 'Editor',
    description: null,
    isSystem: false,
    organizationId: 'org-1',
  }

  const mockSystemRole: Role = {
    id: 'role-admin',
    name: 'ADMIN',
    description: null,
    isSystem: true,
    organizationId: null,
  }

  const mockPermission: Permission = {
    id: 'perm-1',
    action: 'read',
    subject: 'Contact',
    conditions: null,
    fields: [],
    inverted: false,
    organizationId: 'org-1',
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
    service = new RoleService(
      prisma as unknown as PrismaService,
      orgsService as unknown as OrganizationsService
    )
    // OA-12: deleteRole / assignPermission / removePermission all
    // wrap their DB writes + bump in a $transaction. Delegate tx to
    // the same prisma mock so the callback runs and the existing
    // per-call mocks remain reusable inside.
    ;(prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)
    )
  })

  describe('listRoles', () => {
    it('returns system roles and org-specific roles with permissions', async () => {
      prisma.role.findMany.mockResolvedValue([mockSystemRole, mockCustomRole] as never)

      const result = await service.listRoles('org-1', principal)

      expect(result).toHaveLength(2)
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ permissions: expect.anything() }),
        })
      )
    })

    // OA-06: listRoles previously took only orgId — the function-level
    // @CheckPolicies on the controller proved the caller had manage
    // on Organization *somewhere*, but did not bind that decision to
    // the URL :orgId. A switched-in admin of org A could call
    // GET /organizations/{orgB}/roles and read org B's role/permission
    // catalogue (OWASP API1:2023 BOLA). The service now requires the
    // principal and rejects mismatching org context before any
    // Prisma read.
    it('OA-06: throws ForbiddenException when principal.organizationId does not match the requested orgId', async () => {
      const switchedIntoAnotherOrg: RequestPrincipal = {
        ...principal,
        organizationId: 'org-other',
      }

      await expect(service.listRoles('org-1', switchedIntoAnotherOrg)).rejects.toThrow(
        ForbiddenException
      )
      // Critical: rejection must fire before the catalogue read. A
      // pre-read 403 is what makes this a *boundary* fix; a post-read
      // 403 would still leak through e.g. timing channels.
      expect(prisma.role.findMany).not.toHaveBeenCalled()
    })

    it('OA-06: throws ForbiddenException when principal has no org-context', async () => {
      const noOrgPrincipal: RequestPrincipal = {
        ...principal,
        organizationId: undefined,
        aclVersion: undefined,
      }

      await expect(service.listRoles('org-1', noOrgPrincipal)).rejects.toThrow(ForbiddenException)
      expect(prisma.role.findMany).not.toHaveBeenCalled()
    })
  })

  describe('createRole', () => {
    const dto: CreateRoleDto = { name: 'Editor', description: 'Can edit content' } as CreateRoleDto

    it('creates custom role in the org', async () => {
      prisma.role.findFirst.mockResolvedValue(null)
      prisma.role.create.mockResolvedValue(mockCustomRole)

      const result = await service.createRole('org-1', dto, principal)

      expect(result).toEqual(mockCustomRole)
      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isSystem: false, organizationId: 'org-1' }),
        })
      )
    })

    it('throws ForbiddenException when org context mismatches', async () => {
      const wrongPrincipal = { ...principal, organizationId: 'org-other' }
      await expect(service.createRole('org-1', dto, wrongPrincipal)).rejects.toThrow(
        ForbiddenException
      )
    })

    it('throws ConflictException when role name already exists in org', async () => {
      prisma.role.findFirst.mockResolvedValue(mockCustomRole)
      await expect(service.createRole('org-1', dto, principal)).rejects.toThrow(ConflictException)
    })
  })

  describe('updateRole', () => {
    const dto: UpdateRoleDto = { name: 'Senior Editor' } as UpdateRoleDto

    it('updates custom role', async () => {
      prisma.role.findFirst.mockResolvedValueOnce(mockCustomRole) // findCustomRole
      prisma.role.findFirst.mockResolvedValueOnce(null) // no name conflict
      prisma.role.update.mockResolvedValue({ ...mockCustomRole, name: 'Senior Editor' })

      const result = await service.updateRole('org-1', 'role-custom', dto, principal)

      expect(result.name).toBe('Senior Editor')
    })

    it('throws NotFoundException when custom role not found', async () => {
      prisma.role.findFirst.mockResolvedValue(null)
      await expect(service.updateRole('org-1', 'role-custom', dto, principal)).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws ForbiddenException when trying to modify a system role', async () => {
      prisma.role.findFirst.mockResolvedValue(mockSystemRole) // isSystem: true
      await expect(service.updateRole('org-1', 'role-admin', dto, principal)).rejects.toThrow(
        ForbiddenException
      )
    })
  })

  describe('deleteRole', () => {
    it('deletes custom role and bumps aclVersion', async () => {
      prisma.role.findFirst.mockResolvedValue(mockCustomRole)
      prisma.role.delete.mockResolvedValue(mockCustomRole)

      await service.deleteRole('org-1', 'role-custom', principal)

      expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-custom' } })
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx.mock.calls[0]?.[0]).toBe('org-1')
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws ForbiddenException when trying to delete a system role', async () => {
      prisma.role.findFirst.mockResolvedValue(mockSystemRole)
      await expect(service.deleteRole('org-1', 'role-admin', principal)).rejects.toThrow(
        ForbiddenException
      )
    })
  })

  describe('assignPermission', () => {
    const dto: AssignPermissionDto = { action: 'read', subject: 'Contact' } as AssignPermissionDto

    it('creates permission and links it to the role', async () => {
      prisma.role.findFirst.mockResolvedValue(mockCustomRole)
      prisma.permission.create.mockResolvedValue(mockPermission)
      prisma.rolePermission.create.mockResolvedValue({
        roleId: 'role-custom',
        permissionId: 'perm-1',
      })

      const result = await service.assignPermission('org-1', 'role-custom', dto, principal)

      expect(result).toEqual(mockPermission)
      expect(prisma.rolePermission.create).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx.mock.calls[0]?.[0]).toBe('org-1')
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws ForbiddenException when org context mismatches', async () => {
      const wrongPrincipal = { ...principal, organizationId: 'org-other' }
      await expect(
        service.assignPermission('org-1', 'role-custom', dto, wrongPrincipal)
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('removePermission', () => {
    it('deletes org-level permission and bumps aclVersion', async () => {
      prisma.rolePermission.findUnique.mockResolvedValue({
        roleId: 'role-custom',
        permissionId: 'perm-1',
        permission: { organizationId: 'org-1' },
      } as never)
      prisma.permission.delete.mockResolvedValue(mockPermission)

      await service.removePermission('org-1', 'role-custom', 'perm-1', principal)

      expect(prisma.permission.delete).toHaveBeenCalledWith({ where: { id: 'perm-1' } })
      expect(orgsService.bumpAclVersionTx).toHaveBeenCalled()
      expect(orgsService.bumpAclVersionTx.mock.calls[0]?.[0]).toBe('org-1')
      expect(orgsService.invalidateAclVersion).toHaveBeenCalledWith('org-1')
    })

    it('throws NotFoundException when permission link not found', async () => {
      prisma.rolePermission.findUnique.mockResolvedValue(null)
      await expect(
        service.removePermission('org-1', 'role-custom', 'perm-1', principal)
      ).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException when trying to remove a system-level permission', async () => {
      prisma.rolePermission.findUnique.mockResolvedValue({
        roleId: 'role-custom',
        permissionId: 'perm-sys',
        permission: { organizationId: null }, // system-level
      } as never)

      await expect(
        service.removePermission('org-1', 'role-custom', 'perm-sys', principal)
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
