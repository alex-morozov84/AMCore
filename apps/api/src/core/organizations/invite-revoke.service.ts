import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { InviteErrorCode } from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions/index.js'
import { AuditActorType, AuditTargetType } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import { AuditLogService } from '../audit/index.js'
import { rejectManagedInvitation } from '../invitations/provisioning-settlement.js'

import type { InvitationActor } from './invitation-actor.js'
import { InvitationAuthorization } from './invitation-authorization.js'
import { invitationClock, lockInvitation, lockInvitationOrg } from './invitation-locks.js'
import {
  completeInvitationOperation,
  INVITATION_RETENTION_MS,
  invitationConflict,
  invitationFingerprint,
  lockInvitationOperation,
  replayInvitationOperation,
} from './invitation-operation.js'
import { invitationTransaction } from './invitation-transaction.js'

@Injectable()
export class InviteRevokeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: InvitationAuthorization,
    private readonly audit: AuditLogService
  ) {}

  async revoke(
    orgId: string,
    inviteId: string,
    generation: number,
    actor: InvitationActor,
    operationId: string
  ): Promise<void> {
    const intent = { kind: 'revoke', id: inviteId, expectedGeneration: generation }
    await invitationTransaction(this.prisma, async (tx) => {
      const receipt = await lockInvitationOperation(tx, actor.principal.sub, orgId, operationId)
      const user = await this.authorization.lockActor(tx, actor)
      await lockInvitationOrg(tx, orgId)
      await this.authorization.authorize(tx, orgId, actor, user)
      if (
        (await replayInvitationOperation(
          tx,
          receipt,
          operationId,
          invitationFingerprint(intent)
        )) !== undefined
      )
        return
      await rejectManagedInvitation(tx, orgId, { id: inviteId })
      const invite = await lockInvitation(tx, inviteId, orgId)
      if (!invite) throw new NotFoundException('Invitation')
      if (invite.generation !== generation)
        throw invitationConflict(InviteErrorCode.INVITE_GENERATION_CONFLICT)
      if (invite.acceptedAt) throw invitationConflict(InviteErrorCode.INVITE_SETTLED)
      const now = await invitationClock(tx)
      const settled = invite.revokedAt ?? invite.expiresAt
      if (settled.getTime() + INVITATION_RETENTION_MS <= now.getTime())
        throw new NotFoundException('Invitation')
      if (!invite.revokedAt) {
        await tx.orgInvite.update({
          where: { id: invite.id },
          data: { revokedAt: now, revokedById: user.id },
        })
        await this.audit.record(
          {
            action: 'org.invite_revoked',
            actorId: user.id,
            actorType: AuditActorType.USER,
            organizationId: orgId,
            targetId: inviteId,
            targetType: AuditTargetType.ORG_INVITE,
            metadata: {
              actorCredentialType: actor.principal.type,
              generation,
              emailHash: createHash('sha256').update(invite.emailCanonical).digest('hex'),
            },
          },
          { tx }
        )
      }
      await completeInvitationOperation(tx, {
        actorId: user.id,
        organizationId: orgId,
        scope: orgId,
        operationId,
        kind: 'revoke',
        intent,
        result: { status: 'revoked' },
      })
    })
  }
}
