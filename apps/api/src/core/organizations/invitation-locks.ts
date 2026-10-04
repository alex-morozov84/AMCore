import { HttpStatus } from '@nestjs/common'

import { InviteErrorCode } from '@amcore/shared'

import { AppException, ForbiddenException, NotFoundException } from '../../common/exceptions'

import type { OrgInvite, Prisma, SystemRole } from '@/generated/prisma/client'

export type InvitationUser = {
  id: string
  emailCanonical: string
  emailVerified: boolean
  systemRole: SystemRole
}
export function invalidInvitation(): AppException {
  return new AppException(
    'This invite link is invalid or has expired',
    HttpStatus.BAD_REQUEST,
    InviteErrorCode.INVITE_INVALID_OR_EXPIRED
  )
}
export async function lockInvitationUser(
  tx: Prisma.TransactionClient,
  id: string
): Promise<InvitationUser | undefined> {
  const [row] = await tx.$queryRaw<InvitationUser[]>`
    SELECT id, "emailCanonical", "emailVerified", "systemRole" FROM core.users WHERE id = ${id} FOR SHARE`
  return row
}
export async function lockInvitationOrg(
  tx: Prisma.TransactionClient,
  id: string,
  accepting = false
): Promise<void> {
  const [row] = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM core.organizations WHERE id = ${id} FOR UPDATE`
  if (!row) throw accepting ? invalidInvitation() : new NotFoundException('Organization')
}
export async function lockInvitationRole(
  tx: Prisma.TransactionClient,
  roleId: string | null,
  orgId: string,
  accepting = false
): Promise<void> {
  const [role] = roleId
    ? await tx.$queryRaw<{ isSystem: boolean; organizationId: string | null }[]>`
    SELECT "isSystem", "organizationId" FROM core.roles WHERE id = ${roleId} FOR SHARE`
    : []
  if (!role || !((role.isSystem && role.organizationId === null) || role.organizationId === orgId))
    throw accepting
      ? invalidInvitation()
      : new ForbiddenException('Role is not assignable in this organization')
}
export async function lockInvitation(
  tx: Prisma.TransactionClient,
  id: string,
  orgId: string
): Promise<OrgInvite | undefined> {
  const [row] = await tx.$queryRaw<OrgInvite[]>`
    SELECT * FROM core.org_invites WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
  return row
}
export async function invitationClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<{ value: Date }[]>`
    SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS value`
  return clock!.value
}
