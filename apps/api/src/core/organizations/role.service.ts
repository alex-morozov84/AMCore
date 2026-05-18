import { Injectable } from '@nestjs/common'
import type { Permission, Prisma, Role } from '@prisma/client'

import type { RequestPrincipal } from '@amcore/shared'

import { ConflictException, ForbiddenException, NotFoundException } from '../../common/exceptions'
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

  /**
   * List system roles + org-specific custom roles, each with their
   * permissions.
   *
   * OA-06: caller must be in the requested org's context — the
   * @CheckPolicies(Manage, Organization) gate on the controller is
   * function-level (it confirms the principal *has* manage on
   * Organization somewhere) but does not bind the decision to
   * `:orgId`. An admin switched into org A could otherwise call
   * GET /organizations/{orgB}/roles and read org B's custom-role +
   * permission catalogue. Cross-tenant read by URL parameter is the
   * canonical BOLA shape (OWASP API1:2023). assertOrgContext binds
   * the URL `:orgId` to `principal.organizationId`.
   */
  async listRoles(orgId: string, principal: RequestPrincipal): Promise<RoleWithPermissions[]> {
    this.assertOrgContext(principal, orgId)
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
    // OA-12: delete + bump in the same transaction so a transient DB
    // failure cannot leave the cache version diverged from the deleted
    // role's effect on permissions.
    //
    // OA-10: `assignPermission` creates a fresh org-scoped Permission
    // per role assignment, and `Role` has no FK pointing at
    // `Permission` (only the join table `RolePermission` cascades on
    // role delete). Without GC, dropping a custom role leaves its
    // exclusive permissions in the DB until the whole org is dropped.
    //
    // GC is narrow on purpose: collect the permission IDs linked to
    // this role *before* the role.delete cascades the join rows away,
    // then delete only those IDs that are
    //   1. org-scoped (`organizationId === orgId`, never system perms
    //      with `organizationId === null`); and
    //   2. now linked to no roles (`roles: { none: {} }` — survives a
    //      shared-permission case where another role still uses it).
    await this.prisma.$transaction(async (tx) => {
      const links = await tx.rolePermission.findMany({
        where: { roleId },
        select: { permissionId: true },
      })
      const permissionIds = links.map((l) => l.permissionId)

      await tx.role.delete({ where: { id: roleId } })

      if (permissionIds.length > 0) {
        await tx.permission.deleteMany({
          where: {
            id: { in: permissionIds },
            organizationId: orgId,
            roles: { none: {} },
          },
        })
      }

      await this.orgsService.bumpAclVersionTx(orgId, tx)
    })
    await this.orgsService.invalidateAclVersion(orgId)
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

    // OA-12: permission create + role link + bump in the same
    // transaction. Wrapping the existing two-step (permission then
    // rolePermission) here also closes the OA-10 orphan-permission
    // window in part — full OA-10 fix is its own stage, but the
    // transactional bump makes the rolling-back case cleaner.
    const permission = await this.prisma.$transaction(async (tx) => {
      const permission = await tx.permission.create({
        data: {
          action: dto.action,
          subject: dto.subject,
          conditions: (dto.conditions as Prisma.InputJsonValue) ?? undefined,
          fields: dto.fields ?? [],
          inverted: dto.inverted ?? false,
          organizationId: orgId,
        },
      })
      await tx.rolePermission.create({ data: { roleId, permissionId: permission.id } })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
      return permission
    })
    await this.orgsService.invalidateAclVersion(orgId)
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

    // OA-12: delete + bump in the same transaction. Deleting Permission
    // cascades to RolePermission via the FK relation.
    await this.prisma.$transaction(async (tx) => {
      await tx.permission.delete({ where: { id: permId } })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
    })
    await this.orgsService.invalidateAclVersion(orgId)
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
