import { HttpStatus } from '@nestjs/common'

import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../common/exceptions/domain/app.exception.js'
import type { Prisma } from '../../generated/prisma/client.js'

import type { MfaAuthorityDatabase } from './mfa/mfa-authority-reader.service.js'
import { refreshSessionChanged } from './mfa/mfa-refresh-authority.js'
import { assertMfaSensitiveAdmission } from './mfa/mfa-sensitive-admission.js'

/** A stale proof requests step-up; changed family/browser authority terminates the action instead. */
function stepUpRequired(): AppException {
  return new AppException(
    'Step-up authentication required',
    HttpStatus.FORBIDDEN,
    AuthErrorCode.STEP_UP_REQUIRED
  )
}

/**
 * Shared static-route and imperative sensitive-action admission. Protected accounts require the
 * current family plus independently fresh password and second-factor proofs. Ordinary accounts and
 * untouched prepared legacy deployments retain lastAuthAt. Imperative mutations supply their locked
 * transaction for final admission; this helper never acquires locks in a different order.
 */
export async function assertSessionFresh(
  prisma: Pick<Prisma.TransactionClient, 'session'> & MfaAuthorityDatabase,
  windowSec: number,
  principal: RequestPrincipal | undefined,
  clock?: Date
): Promise<void> {
  if (!principal || principal.type !== 'jwt' || !Number.isFinite(windowSec) || windowSec <= 0)
    throw stepUpRequired()
  const sid = principal.sid
  const bound = principal.fid !== undefined || principal.browserBound !== undefined
  if (!sid) throw bound ? refreshSessionChanged() : stepUpRequired()

  // Signed fid selects stable authority. Rotated/deleted historical token rows do not select it.
  if (bound) {
    if (!(await assertMfaSensitiveAdmission(prisma, principal, windowSec)))
      throw refreshSessionChanged()
    return
  }

  const session = await prisma.session.findUnique({
    where: { id: sid },
    select: { lastAuthAt: true, revokedAt: true, expiresAt: true, userId: true, familyId: true },
  })

  const now = clock?.getTime() ?? Date.now()
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= now ||
    session.userId !== principal.sub
  ) {
    throw bound ? refreshSessionChanged() : stepUpRequired()
  }
  if (await assertMfaSensitiveAdmission(prisma, principal, windowSec)) return
  if (
    session.lastAuthAt === null ||
    session.lastAuthAt.getTime() > now ||
    now - session.lastAuthAt.getTime() > windowSec * 1000
  )
    throw stepUpRequired()
}
