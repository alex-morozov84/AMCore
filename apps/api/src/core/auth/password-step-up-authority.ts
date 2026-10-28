import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import type { AuthSessionFamily, Prisma, User } from '../../generated/prisma/client.js'

import type { BrowserRequestBinding } from './mfa/browser-binding.js'
import { requireMfaAdmission } from './mfa/mfa-admission-result.js'
import { MfaAuthorityReader } from './mfa/mfa-authority-reader.service.js'
import { principalBrowserBinding } from './mfa/mfa-principal-binding.js'
import { refreshSessionChanged } from './mfa/mfa-refresh-authority.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa/mfa-transaction.js'

export interface PasswordStepUpSource {
  readonly principal: Readonly<RequestPrincipal>
  readonly browser: BrowserRequestBinding | null
}
export interface PasswordStepUpSnapshot {
  user: User
  version: number
  family: AuthSessionFamily | null
  at: Date
}

export function capturePasswordStepUp(principal: RequestPrincipal): PasswordStepUpSource {
  return Object.freeze({
    principal: Object.freeze({ ...principal }),
    browser: principalBrowserBinding(principal),
  })
}

export function passwordStepUpRequired(source: PasswordStepUpSource): AppException {
  return source.principal.fid !== undefined || source.principal.browserBound !== undefined
    ? refreshSessionChanged()
    : new AppException('Step-up authentication required', 403, AuthErrorCode.STEP_UP_REQUIRED)
}

/** Same source before/after password work. Family liveness never depends on an old SID row. */
export async function lockPasswordStepUp(
  tx: Prisma.TransactionClient,
  source: PasswordStepUpSource
): Promise<PasswordStepUpSnapshot> {
  const { principal, browser } = source
  if (principal.type !== 'jwt' || !principal.sid) throw passwordStepUpRequired(source)
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  if (browser)
    await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${browser.contextId} FOR UPDATE`
  await lockMfaAccounts(tx, [principal.sub])
  if (!principal.fid) await assertLegacySession(tx, source)
  await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${principal.sub} FOR SHARE`
  const user = await tx.user.findUnique({ where: { id: principal.sub } })
  if (!user) throw passwordStepUpRequired(source)
  requireMfaAdmission(
    await new MfaAuthorityReader(tx).readForSensitiveAction(
      { ...principal, email: principal.email ?? '' },
      browser,
      600
    )
  )
  const account = await tx.mfaAccount.findUnique({ where: { userId: principal.sub } })
  const family = principal.fid
    ? await tx.authSessionFamily.findUnique({ where: { id: principal.fid } })
    : null
  if (principal.fid && !family) throw refreshSessionChanged()
  return { user, family, version: account?.securityVersion ?? 0, at: await mfaDatabaseClock(tx) }
}

async function assertLegacySession(
  tx: Prisma.TransactionClient,
  source: PasswordStepUpSource
): Promise<void> {
  const session = await tx.session.findUnique({ where: { id: source.principal.sid } })
  const now = await mfaDatabaseClock(tx)
  if (
    !session ||
    session.userId !== source.principal.sub ||
    session.revokedAt ||
    session.expiresAt <= now
  )
    throw passwordStepUpRequired(source)
}

export function samePasswordSnapshot(
  before: PasswordStepUpSnapshot,
  after: PasswordStepUpSnapshot
): boolean {
  return (
    before.version === after.version &&
    before.user.id === after.user.id &&
    before.user.passwordHash === after.user.passwordHash &&
    before.user.emailCanonical === after.user.emailCanonical &&
    before.user.systemRole === after.user.systemRole &&
    before.family?.id === after.family?.id
  )
}
