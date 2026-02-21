import { ForbiddenException, Injectable } from '@nestjs/common'
import type { OrgMember } from '@prisma/client'

import type { RequestPrincipal } from '@amcore/shared'

import {
  BusinessRuleViolationException,
  ConflictException,
  NotFoundException,
} from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import type { InviteMemberDto } from './dto'
import { OrganizationsService } from './organizations.service'

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService
  ) {}

  /** Add a user to the organization by email. User must already have an account. */
  async invite(
    orgId: string,
    dto: InviteMemberDto,
    principal: RequestPrincipal
  ): Promise<OrgMember> {
    this.assertOrgContext(principal, orgId)

    const targetUser = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!targetUser) throw new NotFoundException('No account found with this email address')

    const existing = await this.prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId: targetUser.id, organizationId: orgId } },
    })
    if (existing) throw new ConflictException('User is already a member of this organization')

    const roleId = dto.roleId ?? (await this.getSystemRoleId('MEMBER'))

    const member = await this.prisma.$transaction(async (tx) => {
      const m = await tx.orgMember.create({
        data: { userId: targetUser.id, organizationId: orgId },
      })
      await tx.memberRole.create({ data: { memberId: m.id, roleId } })
      return m
    })

    await this.orgsService.bumpAclVersion(orgId)
    return member
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    principal: RequestPrincipal
  ): Promise<void> {
    this.assertOrgContext(principal, orgId)

    const member = await this.prisma.orgMember.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    })
    if (!member) throw new NotFoundException('Member not found in this organization')

    await this.assertNotLastAdmin(orgId, targetUserId)
    await this.prisma.orgMember.delete({ where: { id: member.id } })
    await this.orgsService.bumpAclVersion(orgId)
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

    const alreadyAssigned = await this.prisma.memberRole.findUnique({
      where: { memberId_roleId: { memberId: member.id, roleId } },
    })
    if (alreadyAssigned) throw new ConflictException('Member already has this role')

    await this.prisma.memberRole.create({ data: { memberId: member.id, roleId } })
    await this.orgsService.bumpAclVersion(orgId)
  }

  async removeRole(
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

    const adminRoleId = await this.getSystemRoleId('ADMIN')
    if (roleId === adminRoleId) {
      await this.assertNotLastAdmin(orgId, targetUserId)
    }

    await this.prisma.memberRole.deleteMany({ where: { memberId: member.id, roleId } })
    await this.orgsService.bumpAclVersion(orgId)
  }

  /** Guard: target user must not be the last ADMIN in this org */
  private async assertNotLastAdmin(orgId: string, targetUserId: string): Promise<void> {
    const adminRoleId = await this.getSystemRoleId('ADMIN')

    const admins = await this.prisma.memberRole.findMany({
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

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException(
        'Organization context mismatch — call POST /organizations/:id/switch first'
      )
    }
  }

  private async getSystemRoleId(name: 'ADMIN' | 'MEMBER'): Promise<string> {
    const role = await this.prisma.role.findFirst({
      where: { name, isSystem: true, organizationId: null },
      select: { id: true },
    })
    if (!role) throw new Error(`System ${name} role not found. Run: pnpm --filter api prisma:seed`)
    return role.id
  }
}
