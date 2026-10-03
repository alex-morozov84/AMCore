import { HttpStatus } from '@nestjs/common'

import { OrganizationMemberErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

import type { Prisma } from '@/generated/prisma/client'

/** All supported existing-org ACL writers lock the parent before child SQL. */
export async function lockOrganization(
  tx: Prisma.TransactionClient,
  orgId: string
): Promise<{ id: string; aclVersion: number }> {
  const rows = await tx.$queryRaw<{ id: string; aclVersion: number }[]>`
    SELECT id, "aclVersion" FROM core.organizations WHERE id = ${orgId} FOR UPDATE`
  if (!rows[0])
    throw new AppException(
      'Organization unavailable',
      HttpStatus.NOT_FOUND,
      OrganizationMemberErrorCode.MEMBER_UNAVAILABLE
    )
  return rows[0]
}

export async function lockOrganizationMembers(
  tx: Prisma.TransactionClient,
  orgId: string
): Promise<{ id: string; aclVersion: number }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`org:last-admin:${orgId}`}, 0)::bigint)`
  return lockOrganization(tx, orgId)
}
