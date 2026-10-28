import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import type { Prisma } from '../../generated/prisma/client.js'
import { requireMfaAdmission } from '../auth/mfa/mfa-admission-result.js'
import { MfaAuthorityReader } from '../auth/mfa/mfa-authority-reader.service.js'
import { principalBrowserBinding } from '../auth/mfa/mfa-principal-binding.js'
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
  if (principal.fid !== undefined || principal.browserBound !== undefined) {
    requireMfaAdmission(
      await new MfaAuthorityReader(tx).readForRuntime(
        { ...principal, email: principal.email ?? '' },
        principalBrowserBinding(principal)
      )
    )
    return
  }
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
