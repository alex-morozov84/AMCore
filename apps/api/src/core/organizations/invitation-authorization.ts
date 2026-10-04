import { Injectable } from '@nestjs/common'

import { Action, Subject, SystemRole } from '@amcore/shared'

import { ForbiddenException, UnauthorizedException } from '../../common/exceptions'
import { hasFullTeamAccess, normalizeOwnerPermissions } from '../auth/casl/permission-normalization'
import { memberPermissionSnapshot } from '../auth/member-permission-snapshot'

import { assertInvitationActor, type InvitationActor } from './invitation-actor'
import { type InvitationUser, lockInvitationUser } from './invitation-locks'

import type { Prisma } from '@/generated/prisma/client'

export interface LockedInvitationKey {
  expiresAt: Date | null
}
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
  ): Promise<LockedInvitationKey | undefined> {
    const { principal, admission } = actor
    if (principal.organizationId !== orgId) throw new ForbiddenException()
    const superAdmin =
      admission.authenticated.systemRole === SystemRole.SuperAdmin &&
      admission.principal.systemRole === SystemRole.SuperAdmin &&
      admission.currentRole === SystemRole.SuperAdmin &&
      user.systemRole === SystemRole.SuperAdmin
    const snapshot = await memberPermissionSnapshot(tx, user.id, orgId)
    if (
      (!snapshot.memberId && (principal.type === 'api_key' || !superAdmin)) ||
      (!superAdmin &&
        !hasFullTeamAccess(
          normalizeOwnerPermissions(snapshot.permissions, {
            ...principal,
            systemRole: user.systemRole,
          })
        ))
    )
      throw new ForbiddenException('Full team access is required')
    if (principal.type !== 'api_key') return undefined
    const key = actor.key
    if (!key) throw new UnauthorizedException()
    const [row] = await tx.$queryRaw<
      {
        userId: string
        organizationId: string
        revokedAt: Date | null
        keyHash: string | null
        salt: string | null
        scopes: string[]
        expiresAt: Date | null
      }[]
    >`
      SELECT "userId", "organizationId", "revokedAt", "keyHash", salt, scopes, "expiresAt" FROM core.api_keys WHERE id = ${key.keyId} FOR SHARE`
    const scope = `${Action.Manage}:${Subject.TeamAccess}`
    if (
      !row ||
      row.userId !== user.id ||
      row.organizationId !== orgId ||
      row.revokedAt ||
      !row.keyHash ||
      !row.salt ||
      !key.scopes.includes(scope) ||
      !row.scopes.includes(scope)
    )
      throw new UnauthorizedException()
    return { expiresAt: row.expiresAt }
  }

  checkKeyClock(key: LockedInvitationKey | undefined, now: Date): void {
    if (key?.expiresAt && key.expiresAt <= now) throw new UnauthorizedException()
  }
}
