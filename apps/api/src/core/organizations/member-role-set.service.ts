import { HttpStatus, Injectable } from '@nestjs/common'

import {
  OrganizationMemberErrorCode as Code,
  type ReplaceMemberRoles,
  type ReplaceMemberRolesResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import {
  AppException,
  ForbiddenException,
  ServiceUnavailableException,
} from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

import { recordMemberRoles } from './member-role-audit'
import { lockOrganizationMembers } from './organization-mutation-lock'
import { OrganizationsService } from './organizations.service'
import { getSystemRoleId } from './system-role'

import type { Prisma } from '@/generated/prisma/client'

@Injectable()
export class MemberRoleSetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditLogService
  ) {}

  async replace(
    orgId: string,
    userId: string,
    dto: ReplaceMemberRoles,
    principal: RequestPrincipal
  ): Promise<ReplaceMemberRolesResponse> {
    if (principal.organizationId !== orgId) throw new ForbiddenException()
    let result: ReplaceMemberRolesResponse
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const org = await lockOrganizationMembers(tx, orgId)
          const member = await tx.orgMember.findUnique({
            where: { userId_organizationId: { userId, organizationId: orgId } },
          })
          if (!member) throw new AppException('Member unavailable', 404, Code.MEMBER_UNAVAILABLE)
          if (member.id !== dto.expectedMemberId || org.aclVersion !== dto.expectedAclVersion)
            throw new AppException('Roles changed', 409, Code.MEMBER_ROLES_CONFLICT)
          return this.replaceLocked(tx, orgId, userId, member.id, dto, principal)
        },
        { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof AppException) throw error
      // Only the documented transaction write-conflict/deadlock abort is a rejection.
      // P2028 and failures after COMMIT remain uncertain; never replay the write.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')
        throw new AppException('Concurrent mutation aborted', 409, Code.MEMBER_ROLES_CONFLICT)
      throw new ServiceUnavailableException(
        'Role save unconfirmed',
        Code.MEMBER_ROLES_SAVE_UNAVAILABLE
      )
    }
    // Primary ACL version is authoritative; a cache side effect cannot revoke an acknowledged commit.
    await this.organizations.invalidateAclVersion(orgId).catch(() => undefined)
    return result
  }

  private async replaceLocked(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
    memberId: string,
    dto: ReplaceMemberRoles,
    principal: RequestPrincipal
  ): Promise<ReplaceMemberRolesResponse> {
    const roles = await tx.role.findMany({
      where: {
        id: { in: dto.roleIds },
        OR: [{ isSystem: true, organizationId: null }, { organizationId: orgId }],
      },
      select: { id: true },
    })
    if (roles.length !== dto.roleIds.length)
      throw new AppException(
        'Role unavailable',
        HttpStatus.FORBIDDEN,
        Code.MEMBER_ROLE_ASSIGNMENT_DENIED
      )
    const current = await tx.memberRole.findMany({ where: { memberId }, select: { roleId: true } })
    const old = new Set(current.map((r) => r.roleId))
    const desired = new Set(dto.roleIds)
    const added = dto.roleIds.filter((id) => !old.has(id))
    const removed = [...old].filter((id) => !desired.has(id))
    await this.assertAdmin(tx, orgId, removed)
    const changed = added.length + removed.length > 0
    if (changed) {
      await tx.memberRole.deleteMany({ where: { memberId, roleId: { in: removed } } })
      await tx.memberRole.createMany({ data: added.map((roleId) => ({ memberId, roleId })) })
      const cas = await tx.organization.updateMany({
        where: { id: orgId, aclVersion: dto.expectedAclVersion },
        data: { aclVersion: { increment: 1 } },
      })
      if (cas.count !== 1) throw new AppException('Roles changed', 409, Code.MEMBER_ROLES_CONFLICT)
      await recordMemberRoles(
        this.audit,
        tx,
        orgId,
        memberId,
        userId,
        principal,
        added.length,
        removed.length,
        'replace'
      )
    }
    return {
      memberId,
      userId,
      organizationId: orgId,
      roleIds: [...desired].sort(),
      aclVersion: dto.expectedAclVersion + (changed ? 1 : 0),
      changed,
    }
  }

  private async assertAdmin(
    tx: Prisma.TransactionClient,
    orgId: string,
    removed: string[]
  ): Promise<void> {
    const adminId = await getSystemRoleId(tx, 'ADMIN')
    if (!removed.includes(adminId)) return
    const count = await tx.memberRole.count({
      where: { roleId: adminId, member: { organizationId: orgId } },
    })
    if (count === 1) throw new AppException('Last administrator', 400, Code.ORGANIZATION_LAST_ADMIN)
  }
}
