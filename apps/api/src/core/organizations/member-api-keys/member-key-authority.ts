import { SystemRole } from '@amcore/shared'

import { ForbiddenException, UnauthorizedException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'
import {
  hasFullTeamAccess,
  normalizeOwnerPermissions,
} from '../../auth/casl/permission-normalization.js'
import { memberPermissionSnapshot } from '../../auth/member-permission-snapshot.js'

import { assertMemberKeyActor, type MemberKeyActor } from './member-key-actor.js'

export async function lockKeyActor(
  tx: Prisma.TransactionClient,
  actor: MemberKeyActor
): Promise<SystemRole> {
  assertMemberKeyActor(actor)
  const [user] = await tx.$queryRaw<Array<{ systemRole: SystemRole }>>`
    SELECT "systemRole" FROM core.users WHERE id = ${actor.principal.sub} FOR SHARE`
  if (!user) throw new UnauthorizedException()
  return user.systemRole
}
export async function authorizeMemberKeys(
  tx: Prisma.TransactionClient,
  orgId: string,
  actor: MemberKeyActor,
  liveRole: SystemRole,
  removal = false
): Promise<void> {
  const { principal, admission, key } = actor
  if (principal.organizationId !== orgId) throw new ForbiddenException()
  const synthetic =
    liveRole === SystemRole.SuperAdmin &&
    principal.systemRole === SystemRole.SuperAdmin &&
    admission.authenticated.systemRole === SystemRole.SuperAdmin
  const bypass =
    removal &&
    principal.type === 'jwt' &&
    synthetic &&
    admission.authenticated.organizationId === orgId
  const snapshot = await memberPermissionSnapshot(tx, principal.sub, orgId)
  if (snapshot.unsafe.length) throw new ForbiddenException()
  if (!bypass && !snapshot.memberId) throw new ForbiddenException()
  if (!removal && principal.type !== 'jwt') throw new ForbiddenException()
  const trusted =
    synthetic || hasFullTeamAccess(normalizeOwnerPermissions(snapshot.permissions, principal))
  const credential =
    principal.type !== 'api_key' ||
    (key?.organizationId === orgId &&
      key.ownerId === principal.sub &&
      key.scopes.includes('manage:TeamAccess'))
  if (!trusted || !credential) throw new ForbiddenException()
}
