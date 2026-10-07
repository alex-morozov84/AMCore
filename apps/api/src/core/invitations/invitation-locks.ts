import { createHash } from 'node:crypto'

import { HttpStatus } from '@nestjs/common'

import { InviteErrorCode } from '@amcore/shared'

import { AppException, NotFoundException } from '../../common/exceptions'

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
  id: string,
  write = false
): Promise<InvitationUser | undefined> {
  if (write) {
    const [row] = await tx.$queryRaw<InvitationUser[]>`
      SELECT id, "emailCanonical", "emailVerified", "systemRole" FROM core.users WHERE id = ${id} FOR UPDATE`
    return row
  }
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

/** Serialize invited account creation across organizations before any parent lock. */
export async function lockInvitationSignupEmail(
  tx: Prisma.TransactionClient,
  canonical: string
): Promise<void> {
  const key = `invitation-signup:${createHash('sha256').update(canonical).digest('hex')}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
}
