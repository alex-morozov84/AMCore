import { AppException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { accountRequiresMfa } from './mfa-account-policy.js'
import { admitSessionAuthority } from './mfa-session-authority.js'
import type { MfaSourceSessionClaims } from './mfa-session-claims.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

export function settingsSourceChanged(): AppException {
  return new AppException('Original settings source changed', 409, 'AUTH_CONTEXT_CHANGED')
}

/** Source receipt resolution is never authorized by its operation identifier. */
export async function lockSettingsSource(
  tx: Prisma.TransactionClient,
  claims: MfaSourceSessionClaims,
  browser: BrowserRequestBinding
): Promise<{
  now: Date
  account: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['mfaAccount']['findUnique']>>>
  family: NonNullable<
    Awaited<ReturnType<Prisma.TransactionClient['authSessionFamily']['findUnique']>>
  >
  context: NonNullable<
    Awaited<ReturnType<Prisma.TransactionClient['browserAuthContext']['findUnique']>>
  >
}> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${browser.contextId} FOR UPDATE`
  await lockMfaAccounts(tx, [claims.sub])
  await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${claims.sub} FOR SHARE`
  const [user, account, factor, family, context, session, protocol] = await Promise.all([
    tx.user.findUnique({ where: { id: claims.sub }, select: { systemRole: true } }),
    tx.mfaAccount.findUnique({ where: { userId: claims.sub } }),
    tx.mfaFactor.findUnique({ where: { userId: claims.sub } }),
    tx.authSessionFamily.findUnique({ where: { id: claims.fid } }),
    tx.browserAuthContext.findUnique({ where: { id: browser.contextId } }),
    tx.session.findUnique({ where: { id: claims.sid } }),
    tx.mfaProtocol.findUnique({ where: { id: 'platform' } }),
  ])
  const now = await mfaDatabaseClock(tx)
  if (
    !user ||
    !account ||
    !factor ||
    !claims.browserBound ||
    protocol?.state !== 'active' ||
    protocol.version !== 1 ||
    !session ||
    session.userId !== claims.sub ||
    session.familyId !== claims.fid ||
    session.expiresAt <= now ||
    (session.revokedAt && session.revocationReason !== 'rotated') ||
    claims.exp * 1000 <= now.getTime()
  )
    throw settingsSourceChanged()
  const authority = {
    ...account,
    userId: claims.sub,
    systemRole: user.systemRole,
    factorVersion: factor.version,
  }
  if (
    !accountRequiresMfa(authority) ||
    admitSessionAuthority(claims, authority, family, context, now, browser).kind !== 'admitted'
  )
    throw settingsSourceChanged()
  return { now, account, family: family!, context: context! }
}
