import type { Prisma } from '../../generated/prisma/client.js'

import { establishmentError } from './establishment-error.js'
import { hasCanonicalTemplate } from './system-template-validation.js'

export async function canonicalAdmin(db: Pick<Prisma.TransactionClient, 'role'>): Promise<string> {
  const roles = await db.role.findMany({
    where: { name: 'ADMIN', organizationId: null },
    include: { permissions: { include: { permission: true } } },
  })
  if (roles.length !== 1 || !roles[0] || !hasCanonicalTemplate(roles[0]))
    throw establishmentError('SYSTEM_NOT_INITIALIZED', 500)
  return roles[0].id
}
