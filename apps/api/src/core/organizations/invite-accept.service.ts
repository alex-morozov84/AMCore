import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { type AcceptInviteResponse, InviteErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

import {
  invalidInvitation,
  invitationClock,
  lockInvitation,
  lockInvitationOrg,
  lockInvitationRole,
  lockInvitationUser,
} from './invitation-locks'
import { invitationFailure, invitationTransaction } from './invitation-transaction'
import { InviteAcceptLimiterService } from './invite-accept-limiter.service'
import { OrganizationsService } from './organizations.service'

import { AuditActorType, AuditTargetType, type Prisma } from '@/generated/prisma/client'

@Injectable()
export class InviteAcceptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditLogService,
    private readonly limiter: InviteAcceptLimiterService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(InviteAcceptService.name)
  }

  async accept(
    token: string,
    principal: RequestPrincipal,
    ip: string
  ): Promise<AcceptInviteResponse> {
    const fingerprint = InviteAcceptLimiterService.fingerprint(token)
    await this.limiter.check(ip, fingerprint)
    const tokenHash = createHash('sha256').update(token).digest('hex')
    let result: AcceptInviteResponse
    try {
      const hint = await this.prisma.orgInvite
        .findUnique({ where: { tokenHash }, select: { id: true, organizationId: true } })
        .catch(invitationFailure)
      if (!hint) throw invalidInvitation()
      result = await invitationTransaction(this.prisma, (tx) =>
        this.acceptLocked(tx, hint, tokenHash, principal)
      )
    } catch (error) {
      if (
        error instanceof AppException &&
        Object.values(InviteErrorCode).includes(error.errorCode as InviteErrorCode)
      )
        await this.limiter.consume(ip, fingerprint)
      throw error
    }
    await Promise.allSettled([
      this.sideEffect('acl_invalidation', () =>
        this.organizations.invalidateAclVersion(result.organizationId)
      ),
      this.sideEffect('accept_limiter_reset', () => this.limiter.reset(fingerprint)),
    ])
    return result
  }

  private async acceptLocked(
    tx: Prisma.TransactionClient,
    hint: { id: string; organizationId: string },
    hash: string,
    actor: RequestPrincipal
  ): Promise<AcceptInviteResponse> {
    const user = await lockInvitationUser(tx, actor.sub)
    if (!user) throw invalidInvitation()
    const orgId = hint.organizationId
    await lockInvitationOrg(tx, orgId, true)
    const candidate = await tx.orgInvite.findUnique({
      where: { tokenHash: hash },
      select: { roleId: true },
    })
    await lockInvitationRole(tx, candidate?.roleId ?? null, orgId, true)
    const invite = await lockInvitation(tx, hint.id, orgId)
    const now = await invitationClock(tx)
    if (
      !invite ||
      invite.tokenHash !== hash ||
      !invite.roleId ||
      invite.roleId !== candidate?.roleId ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= now ||
      user.emailCanonical !== invite.emailCanonical
    )
      throw invalidInvitation()
    if (!user.emailVerified)
      throw new AppException(
        'Verify your email address before accepting an invite',
        403,
        InviteErrorCode.INVITE_EMAIL_NOT_VERIFIED
      )
    const existing = await tx.orgMember.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      select: { id: true },
    })
    if (existing)
      throw new AppException('You are already a member', 409, InviteErrorCode.INVITE_ALREADY_MEMBER)
    const claimed = await tx.$queryRaw<{ roleId: string }[]>`
      WITH claim_clock AS MATERIALIZED (
        SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS value
      )
      UPDATE core.org_invites SET "acceptedAt" = claim_clock.value,
        "acceptedByUserId" = ${user.id}, "updatedAt" = claim_clock.value
      FROM claim_clock WHERE id = ${invite.id} AND "organizationId" = ${orgId}
        AND "tokenHash" = ${hash} AND "roleId" = ${invite.roleId}
        AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > claim_clock.value
      RETURNING "roleId"`
    if (!claimed[0]) throw invalidInvitation()
    const member = await tx.orgMember.create({
      data: { userId: user.id, organizationId: orgId },
      select: { id: true },
    })
    await tx.memberRole.create({ data: { memberId: member.id, roleId: claimed[0].roleId } })
    await this.organizations.bumpAclVersionTx(orgId, tx)
    await this.audit.record(
      {
        action: 'org.invite_accepted',
        actorId: user.id,
        actorType: AuditActorType.USER,
        organizationId: orgId,
        targetId: invite.id,
        targetType: AuditTargetType.ORG_INVITE,
        metadata: {
          actorCredentialType: actor.type,
          roleId: claimed[0].roleId,
          pinoEvent: 'org.invite.accepted',
        },
      },
      { tx }
    )
    return { organizationId: orgId, roleId: claimed[0].roleId }
  }

  private async sideEffect(category: string, work: () => Promise<void>): Promise<void> {
    try {
      await work()
    } catch {
      this.logger.warn(
        { event: 'org.invite.post_commit_failed', category },
        'Invite committed; post-commit operation failed'
      )
    }
  }
}
