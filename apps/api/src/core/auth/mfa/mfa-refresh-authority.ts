import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { AuthSessionFamily, Prisma, Session } from '../../../generated/prisma/client.js'
import type { AccessTokenPayload } from '../token.service.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { type MfaAuthorityDatabase, MfaAuthorityReader } from './mfa-authority-reader.service.js'
import { liveFamily } from './mfa-policy.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export interface RefreshAuthority {
  claims: AccessTokenPayload
  family: AuthSessionFamily | null
}

export function refreshSessionChanged(): AppException {
  return new AppException('Session authority changed', 409, AuthErrorCode.SESSION_CHANGED)
}

/** Refresh has no residual-access exception: a stored family must still be live/published/current. */
export async function readRefreshAuthority(
  tx: MfaAuthorityDatabase & Pick<Prisma.TransactionClient, 'mfaAccount'>,
  session: Session,
  browser: BrowserRequestBinding | null
): Promise<RefreshAuthority> {
  const user = await tx.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, systemRole: true },
  })
  if (!user || user.id !== session.userId) throw refreshSessionChanged()
  const family = await tx.authSessionFamily.findUnique({ where: { id: session.familyId } })
  const account = await tx.mfaAccount.findUnique({ where: { userId: session.userId } })
  const now = await mfaDatabaseClock(tx)
  if (family && !liveFamily(family, session.userId, account?.securityVersion ?? 0, now))
    throw refreshSessionChanged()
  const claims: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    systemRole: user.systemRole,
    sid: session.id,
    ...(family && {
      fid: family.id,
      securityVersion: family.securityVersion,
      ...(family.browserContextId && { browserBound: true as const }),
    }),
  }
  const result = await new MfaAuthorityReader(tx).readForRuntime(claims, browser)
  if (result.kind === 'denied') {
    if (result.reason === 'enforcement_unavailable')
      throw new ServiceUnavailableException('MFA refresh admission unavailable')
    throw refreshSessionChanged()
  }
  return { claims, family }
}
