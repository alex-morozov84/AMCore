import { InviteErrorCode } from '@amcore/shared'

import { AppException, ForbiddenException } from '../../common/exceptions'
import { isRoleAssignable } from '../organizations/role-assignability-policy'

import { invalidInvitation } from './invitation-locks'
const invitationConflict = (code: InviteErrorCode): AppException =>
  new AppException('Invalid invitation role intent', 409, code)

import { Prisma } from '@/generated/prisma/client'

export type IntentRole = { id: string; name: string; description: string | null }
export async function lockInvitationRoles(
  tx: Prisma.TransactionClient,
  ids: string[],
  orgId: string,
  accepting = false
): Promise<IntentRole[]> {
  if (!ids.length || ids.length > 20)
    throw accepting
      ? invalidInvitation()
      : invitationConflict(InviteErrorCode.INVITE_ROLE_INTENT_INVALID)
  const sorted = [...ids].sort()
  const roles = await tx.$queryRaw<
    (IntentRole & { isSystem: boolean; organizationId: string | null })[]
  >(Prisma.sql`
    SELECT id, name, description, "isSystem", "organizationId" FROM core.roles
    WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR SHARE`)
  if (roles.length !== sorted.length || roles.some((role) => !isRoleAssignable(role, orgId)))
    throw accepting ? invalidInvitation() : new ForbiddenException('Role is not assignable')
  return roles
}
export async function currentInvitationIntent(
  tx: Prisma.TransactionClient,
  inviteId: string,
  orgId: string,
  accepting = false
): Promise<IntentRole[]> {
  const intents = await tx.orgInviteRoleIntent.findMany({
    where: { inviteId },
    orderBy: { ordinal: 'asc' },
  })
  if (
    !intents.length ||
    intents.length > 20 ||
    intents.some((r) => r.liveRoleId !== r.requestedRoleId)
  )
    throw accepting
      ? invalidInvitation()
      : invitationConflict(InviteErrorCode.INVITE_ROLE_INTENT_INVALID)
  return lockInvitationRoles(
    tx,
    intents.map((r) => r.requestedRoleId),
    orgId,
    accepting
  )
}
export function invitationRoleCreate(
  roles: IntentRole[]
): { ordinal: number; requestedRoleId: string; liveRoleId: string; roleNameAtIssue: string }[] {
  return roles.map((role, ordinal) => ({
    ordinal,
    requestedRoleId: role.id,
    liveRoleId: role.id,
    roleNameAtIssue: role.name,
  }))
}

export async function invitationDefaultRole(
  tx: Prisma.TransactionClient
): Promise<IntentRole & { isSystem: boolean }> {
  const roles = await tx.role.findMany({
    where: { name: 'MEMBER', organizationId: null },
    select: { id: true, name: true, description: true, isSystem: true },
    take: 2,
  })
  if (roles.length !== 1 || !roles[0]?.isSystem)
    throw invitationConflict(InviteErrorCode.INVITE_ROLE_INTENT_INVALID)
  return roles[0]
}
