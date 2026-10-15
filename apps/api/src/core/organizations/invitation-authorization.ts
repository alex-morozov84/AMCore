import { Injectable } from '@nestjs/common'

import { ForbiddenException, UnauthorizedException } from '../../common/exceptions/index.js'
import type { Prisma } from '../../generated/prisma/client.js'
import {
  hasFullTeamAccess,
  normalizeOwnerPermissions,
} from '../auth/casl/permission-normalization.js'
import { memberPermissionSnapshot } from '../auth/member-permission-snapshot.js'

import { assertInvitationActor, type InvitationActor } from './invitation-actor.js'
import { type InvitationUser, lockInvitationUser } from './invitation-locks.js'

@Injectable()
export class InvitationAuthorization {
  async lockActor(tx: Prisma.TransactionClient, actor: InvitationActor): Promise<InvitationUser> {
    assertInvitationActor(actor)
    const user = await lockInvitationUser(tx, actor.principal.sub)
    if (!user) throw new UnauthorizedException()
    return user
  }

  async authorize(
    tx: Prisma.TransactionClient,
    orgId: string,
    actor: InvitationActor,
    user: InvitationUser
  ): Promise<void> {
    const { principal } = actor
    if (principal.organizationId !== orgId) throw new ForbiddenException()
    if (principal.type !== 'jwt') throw new ForbiddenException('Personal bearer required')
    const snapshot = await memberPermissionSnapshot(tx, user.id, orgId)
    if (
      !snapshot.memberId ||
      !hasFullTeamAccess(
        normalizeOwnerPermissions(snapshot.permissions, {
          ...principal,
          systemRole: user.systemRole,
        })
      )
    )
      throw new ForbiddenException('Membership and full team access are required')
  }
}
