import { Injectable } from '@nestjs/common'

import {
  BusinessRuleViolationException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

import { assertInvitationActor, type InvitationActor } from './invitation-actor'
import { InvitationAuthorization } from './invitation-authorization'
import { invitationClock, lockInvitation, lockInvitationOrg } from './invitation-locks'
import { invitationTransaction } from './invitation-transaction'

import { AuditActorType, AuditTargetType } from '@/generated/prisma/client'

@Injectable()
export class InviteRevokeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: InvitationAuthorization,
    private readonly audit: AuditLogService
  ) {}

  async revoke(orgId: string, inviteId: string, actor: InvitationActor): Promise<void> {
    assertInvitationActor(actor)
    if (actor.principal.type !== 'jwt' || actor.principal.organizationId !== orgId)
      throw new ForbiddenException()
    await invitationTransaction(this.prisma, async (tx) => {
      const user = await this.authorization.lockActor(tx, actor)
      await lockInvitationOrg(tx, orgId)
      await this.authorization.authorize(tx, orgId, actor, user)
      const invite = await lockInvitation(tx, inviteId, orgId)
      if (!invite) throw new NotFoundException('Invite not found in this organization')
      if (invite.acceptedAt)
        throw new BusinessRuleViolationException(
          'Cannot revoke an accepted invite; remove the member instead'
        )
      if (invite.revokedAt) return
      const revokedAt = await invitationClock(tx)
      await tx.orgInvite.update({
        where: { id: invite.id },
        data: { revokedAt, revokedById: user.id },
      })
      await this.audit.record(
        {
          action: 'org.invite_revoked',
          actorId: user.id,
          actorType: AuditActorType.USER,
          organizationId: orgId,
          targetId: inviteId,
          targetType: AuditTargetType.ORG_INVITE,
          metadata: { actorCredentialType: actor.principal.type, pinoEvent: 'org.invite.revoked' },
        },
        { tx }
      )
    })
  }
}
