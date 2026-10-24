import { createHash } from 'node:crypto'

import { SupportMailErrorCode, type SupportMailFact, type SupportMailKind } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import type { EnvService } from '../../../env/env.service.js'
import type { SupportMailAttempt, User } from '../../../generated/prisma/client.js'
import { resolveFrontendPlacement } from '../../frontend-context/frontend-placement.js'

export const MAIL_LIMITS = {
  prepareMs: 1_800_000,
  deadlineMs: 15_000,
  fenceMs: 250,
  readMs: 86_400_000,
  retentionMs: 604_800_000,
  physical: 2,
} as const
// Equality fingerprint of recipient/policy metadata, never a password or credential.
// PASSWORD_RESET_EXPIRY_MINUTES is a numeric lifetime, despite its password-related name.
export const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
export const recipientBinding = (user: Pick<User, 'emailCanonical'>): string =>
  sha(user.emailCanonical)
export type MailUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'emailCanonical'
  | 'locale'
  | 'name'
  | 'emailVerified'
  | 'passwordHash'
  | 'systemRole'
>
export const MAIL_USER_SELECT = {
  id: true,
  email: true,
  emailCanonical: true,
  locale: true,
  name: true,
  emailVerified: true,
  passwordHash: true,
  systemRole: true,
} as const

export function supportError(code: SupportMailErrorCode, status = 503): AppException {
  return new AppException(code, status, code, { effect: 'none', tokenIssued: false })
}
export const unavailable = (): AppException =>
  supportError(SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE)
export function policyBinding(env: EnvService): string {
  const placement = resolveFrontendPlacement(env)
  return sha(
    JSON.stringify([
      placement.site,
      placement.placementFingerprint,
      env.get('EMAIL_PROVIDER'),
      env.get('EMAIL_FROM'),
      env.get('PASSWORD_RESET_EXPIRY_MINUTES'),
      env.get('EMAIL_VERIFICATION_EXPIRY_HOURS'),
    ])
  )
}
export function lifetime(env: EnvService, kind: SupportMailKind): number {
  return kind === 'password_recovery'
    ? env.get('PASSWORD_RESET_EXPIRY_MINUTES') * 60
    : env.get('EMAIL_VERIFICATION_EXPIRY_HOURS') * 3600
}
export function ineligible(
  user: MailUser,
  kind: SupportMailKind
): 'already_verified' | 'no_password' | null {
  return kind === 'email_verification'
    ? user.emailVerified
      ? 'already_verified'
      : null
    : user.passwordHash
      ? null
      : 'no_password'
}
export function projectAttempt(row: SupportMailAttempt, now: Date): SupportMailFact {
  let outcome: SupportMailFact['outcome']
  let reason = row.reason as SupportMailFact['reason']
  const overdue = row.deadlineAt !== null && row.deadlineAt <= now
  if (row.state === 'claimed' || row.state === 'dispatching') {
    outcome = overdue ? (row.state === 'claimed' ? 'not_started' : 'unknown') : 'in_progress'
    if (overdue) reason = 'deadline'
  } else if (row.state === 'prepared') outcome = 'not_started'
  else outcome = row.state as SupportMailFact['outcome']
  return {
    evidence: overdue && ['claimed', 'dispatching'].includes(row.state) ? 'derived' : 'stored',
    attemptId: row.id,
    kind: row.kind as SupportMailKind,
    outcome,
    reason,
    tokenIssued: row.tokenIssuedAt !== null,
    provider: row.provider as 'resend' | 'mock',
    attemptedAt: (row.claimedAt ?? row.preparedAt).toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    readUntil: row.readUntil.toISOString(),
  }
}
