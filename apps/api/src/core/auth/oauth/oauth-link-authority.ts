import { z } from 'zod'

import {
  AuthErrorCode,
  browserAudienceSchema,
  browserRevisionSchema,
  SystemRole,
} from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'
import { accountRequiresMfa } from '../mfa/mfa-account-policy.js'
import { requireMfaAdmission } from '../mfa/mfa-admission-result.js'
import { MfaAuthorityReader } from '../mfa/mfa-authority-reader.service.js'
import { lockMfaAccounts, mfaDatabaseClock } from '../mfa/mfa-transaction.js'
import type { PasswordStepUpSource } from '../password-step-up-authority.js'

const principal = z.object({
  type: z.literal('jwt'),
  sub: z.string().min(1),
  email: z.string().optional(),
  systemRole: z.enum(SystemRole),
  sid: z.string().min(1).optional(),
  fid: z.string().min(1).optional(),
  securityVersion: z.number().int().nonnegative().optional(),
  browserBound: z.literal(true).optional(),
  exp: z.number().int().positive().optional(),
})
export const oauthLinkAuthoritySchema = z
  .object({
    principal,
    browser: browserRevisionSchema
      .extend({ audience: browserAudienceSchema, bindingHash: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
export type OAuthLinkAuthority = z.infer<typeof oauthLinkAuthoritySchema>
const changed = (): AppException =>
  new AppException('OAuth source session changed', 409, AuthErrorCode.SESSION_CHANGED)

/** Source is captured only from admitted request state. Callback reuses it, never a newer bearer/session. */
export async function authorizeOAuthLink(
  tx: Prisma.TransactionClient,
  userId: string,
  source?: PasswordStepUpSource | OAuthLinkAuthority
): Promise<OAuthLinkAuthority | undefined> {
  const browser = source?.browser
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  if (browser)
    await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${browser.contextId} FOR UPDATE`
  await lockMfaAccounts(tx, [userId])
  await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${userId} FOR SHARE`
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { systemRole: true },
  })
  const account = await tx.mfaAccount.findUnique({ where: { userId } })
  const factor = await tx.mfaFactor.findUnique({ where: { userId } })
  const protectedAccount =
    source?.principal.systemRole === SystemRole.SuperAdmin ||
    accountRequiresMfa({
      systemRole: user.systemRole,
      required: account?.required ?? false,
      emergencyRequired: account?.emergencyRequired ?? false,
      factorVersion: factor?.version ?? null,
    })
  if (!protectedAccount && !source) return undefined
  if (!source || source.principal.sub !== userId) throw changed()
  const now = await mfaDatabaseClock(tx)
  if ('expiresAt' in source && Date.parse(source.expiresAt) <= now.getTime()) throw changed()
  const claims = principal.parse(source.principal)
  const admission = requireMfaAdmission(
    await new MfaAuthorityReader(tx).readForSensitiveAction(
      { ...claims, email: claims.email ?? '' },
      source.browser,
      600
    )
  )
  if (protectedAccount && admission.requiredProofs?.length)
    throw new AppException(
      'Local proof required to link provider',
      403,
      AuthErrorCode.STEP_UP_REQUIRED,
      { requiredProofs: admission.requiredProofs }
    )
  // Ordinary accounts retain their existing linking policy; promotions of old unbound state fail above.
  if (!protectedAccount) return undefined
  if (!claims.fid || claims.securityVersion === undefined) throw changed()
  return oauthLinkAuthoritySchema.parse({
    principal: claims,
    browser: source.browser,
    expiresAt:
      'expiresAt' in source ? source.expiresAt : new Date(now.getTime() + 300000).toISOString(),
  })
}
