import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import type { Prisma } from '../../generated/prisma/client.js'
import { assertSessionFresh } from '../auth/session-freshness.js'

import { establishmentError } from './establishment-error.js'

export type SetupOperator = { principal: RequestPrincipal; freshWindowSeconds: number }

/** All reads use tx, including the last admission after lock waits. CLI trust is local deployment access. */
export async function admitSetupOperator(
  tx: Prisma.TransactionClient,
  operator?: SetupOperator,
  fresh = false
): Promise<void> {
  if (!operator) return
  const { principal } = operator
  if (principal.type !== 'jwt' || principal.systemRole !== SystemRole.SuperAdmin || !principal.sid)
    throw establishmentError('FORBIDDEN', 403)
  const user = await tx.user.findUnique({
    where: { id: principal.sub },
    select: { systemRole: true },
  })
  if (user?.systemRole !== SystemRole.SuperAdmin) throw establishmentError('FORBIDDEN', 403)
  if (fresh) return assertSessionFresh(tx, operator.freshWindowSeconds, principal)
  const session = await tx.session.findUnique({
    where: { id: principal.sid },
    select: { userId: true, revokedAt: true, expiresAt: true },
  })
  if (
    !session ||
    session.userId !== principal.sub ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now()
  )
    throw establishmentError('UNAUTHORIZED', 401)
}
