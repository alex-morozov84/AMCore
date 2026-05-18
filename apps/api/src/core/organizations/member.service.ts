import { Injectable } from '@nestjs/common'
import type { OrgMember, Prisma } from '@prisma/client'

import type { RequestPrincipal } from '@amcore/shared'

import {
  BusinessRuleViolationException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { EmailIdentityService } from '../auth/email-identity.service'

import type { InviteMemberDto } from './dto'
import { OrganizationsService } from './organizations.service'
import { RoleAssignabilityService } from './role-assignability.service'

type PrismaTx = Prisma.TransactionClient

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService,
    private readonly emailIdentity: EmailIdentityService,
    private readonly roleAssignability: RoleAssignabilityService
  ) {}

  /** Add a user to the organization by email. User must already have an account. */
  async invite(
    orgId: string,
    dto: InviteMemberDto,
    principal: RequestPrincipal
  ): Promise<OrgMember> {
    this.assertOrgContext(principal, orgId)

    const emailCanonical = this.emailIdentity.canonicalize(dto.email)
    const targetUser = await this.prisma.user.findUnique({ where: { emailCanonical } })
    if (!targetUser) throw new NotFoundException('No account found with this email address')

    const existing = await this.prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId: targetUser.id, organizationId: orgId } },
    })
    if (existing) throw new ConflictException('User is already a member of this organization')

    const roleId = dto.roleId ?? (await this.getSystemRoleId('MEMBER'))

    const member = await this.prisma.$transaction(async (tx) => {
      // OA-05: validate role ownership inside the same transaction so
      // the role's organizationId can't change between check and write.
      await this.roleAssignability.assert(roleId, orgId, tx)
      const m = await tx.orgMember.create({
        data: { userId: targetUser.id, organizationId: orgId },
      })
      await tx.memberRole.create({ data: { memberId: m.id, roleId } })
      // OA-12: bump aclVersion inside the same transaction so the
      // cache version cannot diverge from the ACL state on a
      // transient DB failure between the membership write and the
      // bump. Cache invalidation (OA-04) is intentionally outside
      // the transaction — see post-commit call below.
      await this.orgsService.bumpAclVersionTx(orgId, tx)
      return m
    })

    await this.orgsService.invalidateAclVersion(orgId)
    return member
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    principal: RequestPrincipal
  ): Promise<void> {
    this.assertOrgContext(principal, orgId)

    // OA-09 companion: all last-admin-sensitive reads happen inside
    // the transaction after acquiring a per-org advisory lock. Under
    // Postgres READ COMMITTED, two concurrent removeMember calls would
    // otherwise both see two admins and both succeed, leaving the org
    // with zero administrators. The advisory lock serializes them on
    // the same `org:last-admin:${orgId}` key so the second caller
    // observes the post-commit state of the first.
    await this.prisma.$transaction(async (tx) => {
      await this.acquireXactLock(tx, `org:last-admin:${orgId}`)

      const member = await tx.orgMember.findUnique({
        where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
      })
      if (!member) throw new NotFoundException('Member not found in this organization')

      await this.assertNotLastAdmin(orgId, targetUserId, tx)

      // OA-12: delete + bump in the same transaction so a transient
      // DB failure between delete and bump cannot leave the cache
      // serving stale permissions for the removed member.
      await tx.orgMember.delete({ where: { id: member.id } })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
    })
    await this.orgsService.invalidateAclVersion(orgId)
  }

  async assignRole(
    orgId: string,
    targetUserId: string,
    roleId: string,
    principal: RequestPrincipal
  ): Promise<void> {
    this.assertOrgContext(principal, orgId)

    const member = await this.prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    })
    if (!member) throw new NotFoundException('Member not found in this organization')

    // OA-05: role-ownership validation + assignment in the same
    // transaction so the role's organizationId can't change between
    // check and write. Conflict detection is hoisted into the same
    // transaction for the same reason.
    // OA-12: bump aclVersion inside the same transaction.
    await this.prisma.$transaction(async (tx) => {
      await this.roleAssignability.assert(roleId, orgId, tx)

      const alreadyAssigned = await tx.memberRole.findUnique({
        where: { memberId_roleId: { memberId: member.id, roleId } },
      })
      if (alreadyAssigned) throw new ConflictException('Member already has this role')

      await tx.memberRole.create({ data: { memberId: member.id, roleId } })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
    })
    await this.orgsService.invalidateAclVersion(orgId)
  }

  async removeRole(
    orgId: string,
    targetUserId: string,
    roleId: string,
    principal: RequestPrincipal
  ): Promise<void> {
    this.assertOrgContext(principal, orgId)

    // OA-09 companion: lock + read + assertion + write all inside one
    // transaction. See `removeMember` for the full rationale on the
    // advisory lock.
    await this.prisma.$transaction(async (tx) => {
      await this.acquireXactLock(tx, `org:last-admin:${orgId}`)

      const member = await tx.orgMember.findUnique({
        where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
      })
      if (!member) throw new NotFoundException('Member not found in this organization')

      const adminRoleId = await this.getSystemRoleId('ADMIN', tx)
      if (roleId === adminRoleId) {
        await this.assertNotLastAdmin(orgId, targetUserId, tx)
      }

      // OA-12: deleteMany + bump in the same transaction so a transient
      // DB failure cannot leave the cache stale on a partial role-removal.
      await tx.memberRole.deleteMany({ where: { memberId: member.id, roleId } })
      await this.orgsService.bumpAclVersionTx(orgId, tx)
    })
    await this.orgsService.invalidateAclVersion(orgId)
  }

  /**
   * Guard: target user must not be the last ADMIN in this org.
   *
   * Must be called inside the same transaction that performs the
   * subsequent removal, and only after `acquireXactLock` on the
   * org-scoped last-admin key — otherwise two callers can both pass
   * this check and both commit, leaving the org with no admins.
   */
  private async assertNotLastAdmin(
    orgId: string,
    targetUserId: string,
    tx: PrismaTx
  ): Promise<void> {
    const adminRoleId = await this.getSystemRoleId('ADMIN', tx)

    const admins = await tx.memberRole.findMany({
      where: { roleId: adminRoleId, member: { organizationId: orgId } },
      include: { member: { select: { userId: true } } },
    })

    const isTarget = admins.some((mr) => mr.member.userId === targetUserId)
    if (isTarget && admins.length === 1) {
      throw new BusinessRuleViolationException(
        'Cannot remove the last administrator from an organization'
      )
    }
  }

  /**
   * Transaction-scoped advisory lock — parameterized `$executeRaw`
   * tagged template so the key is never string-interpolated. Mirrors
   * the helper in `AdminService` (OA-09).
   */
  private async acquireXactLock(tx: PrismaTx, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
  }

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException(
        'Organization context mismatch — call POST /organizations/:id/switch first'
      )
    }
  }

  private async getSystemRoleId(
    name: 'ADMIN' | 'MEMBER',
    db: PrismaService | PrismaTx = this.prisma
  ): Promise<string> {
    const role = await db.role.findFirst({
      where: { name, isSystem: true, organizationId: null },
      select: { id: true },
    })
    if (!role) throw new Error(`System ${name} role not found. Run: pnpm --filter api prisma:seed`)
    return role.id
  }
}
