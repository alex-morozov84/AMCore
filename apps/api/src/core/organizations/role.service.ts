import { Injectable } from '@nestjs/common'

import type {
  OrgRoleResponse,
  PermissionResponse,
  RequestPrincipal,
  RoleListResponse,
} from '@amcore/shared'

import { ConflictException, ForbiddenException, NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'
import {
  type PermissionWriteInput,
  validatePermissionRule,
} from '../auth/casl/permission-rule-validation'

import type { CreateRoleDto, UpdateRoleDto } from './dto'
import { lockOrganization } from './organization-mutation-lock'
import { OrganizationsService } from './organizations.service'
import { assignableRolesWhere } from './role-assignability-policy'
import { recordRoleDefinition, type RoleAuditFacts } from './role-definition-audit'

import type { Permission, Prisma, Role } from '@/generated/prisma/client'

export type RoleWithPermissions = Role & { permissions: { permission: Permission }[] }

const withPermissions = { permissions: { include: { permission: true } } } as const

/**
 * Legacy per-rule / metadata role routes. Every writer now serializes on the parent organization
 * lock, bumps the revision once and writes one in-transaction audit row, so no older writer can
 * change persisted role state without the revision fence the role-definition editor relies on.
 * Request/response shapes and the case-sensitive name semantics of these routes are unchanged.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService,
    private readonly audit: AuditLogService
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
  async listRoles(
    orgId: string,
    principal: RequestPrincipal,
    page: number,
    limit: number
  ): Promise<RoleListResponse> {
    this.assertOrgContext(principal, orgId)

    // ADR-036: `Role` has no `createdAt`. Endpoint-local sort key:
    // `isSystem DESC, name ASC, id ASC` — system roles first as a
    // stable section header for the client, alphabetical within
    // each section, id as the final deterministic tie-break.
    const where = assignableRolesWhere(orgId)
    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        include: withPermissions,
      }),
      this.prisma.role.count({ where }),
    ])

    return {
      data: rows.map((row) => this.toOrgRoleResponse(row)),
      total,
      page,
      limit,
    }
  }

  private toOrgRoleResponse(row: RoleWithPermissions): OrgRoleResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      organizationId: row.organizationId,
      permissions: row.permissions.map((rp) => this.toPermissionResponse(rp.permission)),
    }
  }

  private toPermissionResponse(permission: Permission): PermissionResponse {
    return {
      id: permission.id,
      action: permission.action,
      subject: permission.subject,
      conditions: permission.conditions,
      fields: permission.fields,
      inverted: permission.inverted,
      organizationId: permission.organizationId,
    }
  }

  async createRole(
    orgId: string,
    dto: CreateRoleDto,
    principal: RequestPrincipal
  ): Promise<OrgRoleResponse> {
    this.assertOrgContext(principal, orgId)
    const role = await this.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, orgId)
      const existing = await tx.role.findFirst({
        where: { name: dto.name, organizationId: orgId },
      })
      if (existing)
        throw new ConflictException(`Role '${dto.name}' already exists in this organization`)
      const created = await tx.role.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          organizationId: orgId,
          isSystem: false,
        },
        include: withPermissions,
      })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
      await this.record(tx, 'org.role_created', orgId, principal, created.id, org.aclVersion, {
        nameChanged: true,
        descriptionChanged: created.description !== null,
      })
      return created
    })
    await this.orgsService.invalidateAclVersion(orgId)
    return this.toOrgRoleResponse(role)
  }

  async updateRole(
    orgId: string,
    roleId: string,
    dto: UpdateRoleDto,
    principal: RequestPrincipal
  ): Promise<OrgRoleResponse> {
    this.assertOrgContext(principal, orgId)
    const updated = await this.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, orgId)
      const role = await this.findCustomRole(orgId, roleId, tx)

      if (dto.name && dto.name !== role.name) {
        const nameConflict = await tx.role.findFirst({
          where: { name: dto.name, organizationId: orgId, id: { not: roleId } },
        })
        if (nameConflict) throw new ConflictException(`Role '${dto.name}' already exists`)
      }
      const nameChanged = dto.name !== undefined && dto.name !== role.name
      const descriptionChanged =
        dto.description !== undefined && dto.description !== role.description

      // A true no-op (unchanged or empty patch) returns the stored role without any write.
      if (!nameChanged && !descriptionChanged)
        return tx.role.findUniqueOrThrow({ where: { id: roleId }, include: withPermissions })
      const row = await tx.role.update({
        where: { id: roleId },
        data: dto,
        include: withPermissions,
      })
      // A real change advances the revision so no stale definition save can overwrite it.
      await this.orgsService.bumpAclVersionTx(orgId, tx)
      await this.record(tx, 'org.role_updated', orgId, principal, roleId, org.aclVersion, {
        nameChanged,
        descriptionChanged,
      })
      return row
    })
    await this.orgsService.invalidateAclVersion(orgId)
    return this.toOrgRoleResponse(updated)
  }

  async deleteRole(orgId: string, roleId: string, principal: RequestPrincipal): Promise<void> {
    this.assertOrgContext(principal, orgId)
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
      const org = await lockOrganization(tx, orgId)
      await this.findCustomRole(orgId, roleId, tx)
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
      await this.record(tx, 'org.role_deleted', orgId, principal, roleId, org.aclVersion, {
        removedPresetCount: permissionIds.length,
      })
    })
    await this.orgsService.invalidateAclVersion(orgId)
  }

  /** Create a permission and assign it to the role */
  async assignPermission(
    orgId: string,
    roleId: string,
    dto: PermissionWriteInput,
    principal: RequestPrincipal
  ): Promise<PermissionResponse> {
    this.assertOrgContext(principal, orgId)
    validatePermissionRule(dto)

    // OA-12: permission create + role link + bump in the same
    // transaction. Wrapping the existing two-step (permission then
    // rolePermission) here also closes the OA-10 orphan-permission
    // window in part — full OA-10 fix is its own stage, but the
    // transactional bump makes the rolling-back case cleaner.
    const permission = await this.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, orgId)
      await this.findCustomRole(orgId, roleId, tx)
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
      await this.record(tx, 'org.role_updated', orgId, principal, roleId, org.aclVersion, {
        addedPresetCount: 1,
        fullControl: dto.subject === 'TeamAccess' && !dto.inverted ? 'added' : 'none',
      })
      return permission
    })
    await this.orgsService.invalidateAclVersion(orgId)
    return this.toPermissionResponse(permission)
  }

  /**
   * Detach the permission from THIS role only. The Permission row itself is collected only when it
   * is org-scoped and no other role still links it — a shared row keeps serving its other roles.
   */
  async removePermission(
    orgId: string,
    roleId: string,
    permId: string,
    principal: RequestPrincipal
  ): Promise<void> {
    this.assertOrgContext(principal, orgId)

    // OA-12: detach + bump in the same transaction.
    await this.prisma.$transaction(async (tx) => {
      const org = await lockOrganization(tx, orgId)
      await this.findCustomRole(orgId, roleId, tx)
      const link = await tx.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId, permissionId: permId } },
        include: {
          permission: {
            select: { organizationId: true, subject: true, inverted: true, action: true },
          },
        },
      })
      if (!link) throw new NotFoundException('Permission not found on this role')
      if (link.permission.organizationId !== orgId) {
        throw new ForbiddenException('Cannot remove system-level permissions')
      }

      await tx.rolePermission.delete({
        where: { roleId_permissionId: { roleId, permissionId: permId } },
      })
      await tx.permission.deleteMany({
        where: { id: permId, organizationId: orgId, roles: { none: {} } },
      })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
      await this.record(tx, 'org.role_updated', orgId, principal, roleId, org.aclVersion, {
        removedPresetCount: 1,
        fullControl:
          link.permission.subject === 'TeamAccess' &&
          link.permission.action === 'manage' &&
          !link.permission.inverted
            ? 'removed'
            : 'none',
      })
    })
    await this.orgsService.invalidateAclVersion(orgId)
  }

  /** Strict in-transaction audit; counts for the per-rule routes are rules, not presets. */
  private record(
    tx: Prisma.TransactionClient,
    action: 'org.role_created' | 'org.role_updated' | 'org.role_deleted',
    orgId: string,
    principal: RequestPrincipal,
    roleId: string,
    revisionBefore: number,
    facts: Partial<RoleAuditFacts>
  ): Promise<void> {
    return recordRoleDefinition(this.audit, tx, action, orgId, principal, {
      roleId,
      revisionBefore,
      revisionAfter: revisionBefore + 1,
      addedPresetCount: 0,
      removedPresetCount: 0,
      fullControl: 'none',
      nameChanged: false,
      descriptionChanged: false,
      ...facts,
      source: 'legacy',
    })
  }

  /** Only org-specific, non-system roles can be managed */
  private async findCustomRole(
    orgId: string,
    roleId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma
  ): Promise<Role> {
    const role = await db.role.findFirst({ where: { id: roleId, organizationId: orgId } })
    if (!role) throw new NotFoundException('Custom role not found in this organization')
    if (role.isSystem) throw new ForbiddenException('System roles cannot be modified')
    return role
  }

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException('Organization context does not match the operation target')
    }
  }
}
