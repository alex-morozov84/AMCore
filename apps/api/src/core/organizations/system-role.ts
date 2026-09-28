import { HttpStatus } from '@nestjs/common'

import { AppException } from '../../common/exceptions'

import type { Prisma } from '@/generated/prisma/client'

/** Nullable composite uniqueness does not guarantee one global template. */
export async function getSystemRoleId(
  db: Pick<Prisma.TransactionClient, 'role'>,
  name: 'ADMIN' | 'MEMBER' | 'VIEWER'
): Promise<string> {
  const roles = await db.role.findMany({
    where: { name, organizationId: null },
    select: { id: true, isSystem: true },
  })
  if (roles.length !== 1 || !roles[0]?.isSystem) {
    throw new AppException(
      'System templates missing or ambiguous; audit and initialize explicitly',
      HttpStatus.INTERNAL_SERVER_ERROR,
      'SYSTEM_NOT_INITIALIZED'
    )
  }
  return roles[0].id
}
