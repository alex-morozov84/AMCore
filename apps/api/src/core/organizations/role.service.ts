import { ForbiddenException, Injectable } from '@nestjs/common'
import type { Permission, Prisma, Role } from '@prisma/client'

import type { RequestPrincipal } from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import type { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto'
import { OrganizationsService } from './organizations.service'

export type RoleWithPermissions = Role & { permissions: { permission: Permission }[] }

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService
  ) {}

  /** List system roles + org-specific custom roles, each with their permissions */
  async listRoles(orgId: string): Promise<RoleWithPermissions[]> {
    return this.prisma.role.findMany({
      where: { OR: [{ organizationId: orgId }, { isSystem: true, organizationId: null }] },
      include: { permissions: { include: { permission: true } } },
    })
  }

  async createRole(orgId: string, dto: CreateRoleDto, principal: RequestPrincipal): Promise<Role> {
    this.assertOrgContext(principal, orgId)

    const existing = await this.prisma.role.findFirst({
      where: { name: dto.name, organizationId: orgId },
    })
    if (existing)
      throw new ConflictException(`Role '${dto.name}' already exists in this organization`)

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        organizationId: orgId,
        isSystem: false,
      },
    })
  }

  async updateRole(
    orgId: string,
    roleId: string,
    dto: UpdateRoleDto,
    principal: RequestPrincipal
  ): Promise<Role> {
    this.assertOrgContext(principal, orgId)
    const role = await this.findCustomRole(orgId, roleId)

    if (dto.name && dto.name !== role.name) {
      const nameConflict = await this.prisma.role.findFirst({
        where: { name: dto.name, organizationId: orgId, id: { not: roleId } },
      })
      if (nameConflict) throw new ConflictException(`Role '${dto.name}' already exists`)
    }

    return this.prisma.role.update({ where: { id: roleId }, data: dto })
  }

  async deleteRole(orgId: string, roleId: string, principal: RequestPrincipal): Promise<void> {
    this.assertOrgContext(principal, orgId)
    await this.findCustomRole(orgId, roleId)
    await this.prisma.role.delete({ where: { id: roleId } })
    await this.orgsService.bumpAclVersion(orgId)
  }

  /** Create a permission and assign it to the role */
  async assignPermission(
    orgId: string,
    roleId: string,
    dto: AssignPermissionDto,
    principal: RequestPrincipal
  ): Promise<Permission> {
    this.assertOrgContext(principal, orgId)
    await this.findCustomRole(orgId, roleId)

    const permission = await this.prisma.permission.create({
      data: {
        action: dto.action,
        subject: dto.subject,
        conditions: (dto.conditions as Prisma.InputJsonValue) ?? undefined,
        fields: dto.fields ?? [],
        inverted: dto.inverted ?? false,
        organizationId: orgId,
      },
    })
    await this.prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    await this.orgsService.bumpAclVersion(orgId)
    return permission
  }

  /** Remove a permission from the role and delete the permission record */
  async removePermission(
    orgId: string,
    roleId: string,
    permId: string,
    principal: RequestPrincipal
  ): Promise<void> {
    this.assertOrgContext(principal, orgId)

    const link = await this.prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId, permissionId: permId } },
      include: { permission: { select: { organizationId: true } } },
    })
    if (!link) throw new NotFoundException('Permission not found on this role')
    if (link.permission.organizationId !== orgId) {
      throw new ForbiddenException('Cannot remove system-level permissions')
    }

    // Deleting Permission cascades to RolePermission
    await this.prisma.permission.delete({ where: { id: permId } })
    await this.orgsService.bumpAclVersion(orgId)
  }

  /** Only org-specific, non-system roles can be managed */
  private async findCustomRole(orgId: string, roleId: string): Promise<Role> {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: orgId } })
    if (!role) throw new NotFoundException('Custom role not found in this organization')
    if (role.isSystem) throw new ForbiddenException('System roles cannot be modified')
    return role
  }

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException(
        'Organization context mismatch — call POST /organizations/:id/switch first'
      )
    }
  }
}
