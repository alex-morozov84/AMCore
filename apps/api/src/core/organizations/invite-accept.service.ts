import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  type AcceptIntent,
  type AcceptInviteResponse,
  type InvitationOperationResponse,
  invitationOperationResponseSchema,
  InviteErrorCode,
  type RequestPrincipal,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'
import {
  type InvitationCredential,
  invitationCredentialHint,
  invitationSecretHash,
} from '../invitations/invitation-credential'
import { InvitationLiveSessionService } from '../invitations/invitation-live-session.service'
import { currentInvitationIntent } from '../invitations/invitation-role-intent'

import {
  invalidInvitation,
  invitationClock,
  lockInvitation,
  lockInvitationOrg,
  lockInvitationUser,
} from './invitation-locks'
import {
  completeInvitationOperation,
  INVITATION_RETENTION_MS,
  invitationFingerprint,
  lockInvitationOperation,
  parseInvitationOperationId,
  replayInvitationOperation,
} from './invitation-operation'
import { invitationPostCommit } from './invitation-post-commit'
import { invitationTransaction } from './invitation-transaction'
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
    private readonly logger: PinoLogger,
    private readonly liveSession: InvitationLiveSessionService
  ) {
    this.logger.setContext(InviteAcceptService.name)
  }

  async accept(
    credential: InvitationCredential,
    intent: AcceptIntent,
    operationId: string,
    principal: RequestPrincipal,
    ip: string
  ): Promise<AcceptInviteResponse> {
    const secret = ('token' in credential ? credential.token : credential.continuation) ?? ''
    const fingerprint = InviteAcceptLimiterService.fingerprint(secret)
    await this.limiter.check(ip, fingerprint)
    const stableIntent = { kind: 'accept', ...intent }
    const result = await invitationTransaction(this.prisma, async (tx) => {
      const receipt = await lockInvitationOperation(tx, principal.sub, 'personal', operationId)
      const user = await lockInvitationUser(tx, principal.sub)
      await this.liveSession.assert(principal, tx)
      const replay = await replayInvitationOperation(
        tx,
        receipt,
        operationId,
        invitationFingerprint(stableIntent)
      )
      if (replay !== undefined)
        return invitationOperationResponseSchema.options[1].shape.result.parse(replay)
      if (!user) throw invalidInvitation()
      const fresh = await this.acceptLocked(tx, credential, intent, user, principal)
      await completeInvitationOperation(tx, {
        actorId: user.id,
        organizationId: fresh.organizationId,
        scope: 'personal',
        operationId,
        kind: 'accept',
        intent: stableIntent,
        result: fresh,
      })
      return fresh
    }).catch(async (error: unknown) => {
      if (
        error instanceof AppException &&
        Object.values(InviteErrorCode).includes(error.errorCode as InviteErrorCode)
      )
        await this.limiter.consume(ip, fingerprint)
      throw error
    })
    const reason = await invitationPostCommit(() =>
      this.organizations.invalidateAclVersion(result.organizationId)
    )
    if (reason)
      this.logger.warn(
        { event: 'org.invite.post_commit_failed', category: 'acl_invalidation', reason },
        'Invitation committed'
      )
    const resetReason = await invitationPostCommit(() => this.limiter.reset(fingerprint))
    if (resetReason)
      this.logger.warn(
        {
          event: 'org.invite.post_commit_failed',
          category: 'accept_limiter_reset',
          reason: resetReason,
        },
        'Invite committed; post-commit operation failed'
      )
    return result
  }

  async operation(id: string, principal: RequestPrincipal): Promise<InvitationOperationResponse> {
    parseInvitationOperationId(id)
    return invitationTransaction(this.prisma, async (tx) => {
      await this.liveSession.assert(principal, tx)
      const row = await tx.invitationOperation.findUnique({
        where: {
          actorId_scope_operationId: { actorId: principal.sub, scope: 'personal', operationId: id },
        },
      })
      const now = await invitationClock(tx)
      if (!row || now.getTime() - row.completedAt.getTime() >= INVITATION_RETENTION_MS)
        return { state: 'unknown' }
      const result = invitationOperationResponseSchema.options[1].shape.result.parse(row.result)
      const member = await tx.orgMember.findUnique({
        where: {
          userId_organizationId: { userId: principal.sub, organizationId: result.organizationId },
        },
        select: { id: true },
      })
      // A replacement membership is not proof the original accepted membership survived.
      const present =
        !!member && (result.status === 'already_access' || member.id === result.memberId)
      const stored = row.intent as unknown as AcceptIntent
      return {
        state: 'committed',
        intent: {
          expectedInviteId: stored.expectedInviteId,
          expectedGeneration: stored.expectedGeneration,
        },
        result,
        access: present ? 'present' : 'removed',
      }
    })
  }

  private async acceptLocked(
    tx: Prisma.TransactionClient,
    credential: InvitationCredential,
    intent: AcceptIntent,
    user: { id: string; emailCanonical: string; emailVerified: boolean },
    actor: RequestPrincipal
  ): Promise<AcceptInviteResponse> {
    const hint = await invitationCredentialHint(tx, credential)
    const orgId = hint.invite.organizationId
    await lockInvitationOrg(tx, orgId, true)
    const roles = await currentInvitationIntent(tx, hint.invite.id, orgId, true)
    const invite = await lockInvitation(tx, hint.invite.id, orgId)
    const now = await invitationClock(tx)
    if (
      !invite ||
      invite.id !== intent.expectedInviteId ||
      invite.generation !== intent.expectedGeneration ||
      invite.generation !== hint.generation ||
      invite.tokenHash !== hint.invite.tokenHash ||
      invite.intentInvalid ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= now ||
      hint.expiresAt <= now ||
      user.emailCanonical !== invite.emailCanonical
    )
      throw invalidInvitation()
    if (!user.emailVerified)
      throw new AppException(
        'Email verification required',
        403,
        InviteErrorCode.INVITE_EMAIL_NOT_VERIFIED
      )
    const existing = await tx.orgMember.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId: orgId },
      },
      select: { id: true },
    })
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      WITH claim_clock AS MATERIALIZED (SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS value)
      UPDATE core.org_invites SET "acceptedAt" = claim_clock.value, "acceptedByUserId" = ${user.id}, "updatedAt" = claim_clock.value
      FROM claim_clock WHERE id = ${invite.id} AND generation = ${intent.expectedGeneration}
        AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > claim_clock.value
        AND ${hint.expiresAt} > claim_clock.value RETURNING id`
    if (!claimed[0]) throw invalidInvitation()
    const member =
      existing ??
      (await tx.orgMember.create({
        data: { userId: user.id, organizationId: orgId },
        select: { id: true },
      }))
    if (!existing) {
      await tx.memberRole.createMany({
        data: roles.map((role) => ({ memberId: member.id, roleId: role.id })),
      })
      await this.organizations.bumpAclVersionTx(orgId, tx)
    }
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
          generation: invite.generation,
          branch: existing ? 'already_access' : 'accepted',
          emailHash: invitationSecretHash(invite.emailCanonical),
          roleIds: roles.map((r) => r.id),
        },
      },
      { tx }
    )
    return existing
      ? { status: 'already_access', organizationId: orgId }
      : { status: 'accepted', organizationId: orgId, memberId: member.id }
  }
}
