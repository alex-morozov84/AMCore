import { z } from 'zod'

import type { OAuthTokens } from '@amcore/shared'

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email().optional(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
})

/** Call only with claims from a successfully verified token response. */
export function appleVerifiedIdentity(
  claims: unknown
): NonNullable<OAuthTokens['verifiedIdentity']> {
  const value = claimsSchema.parse(claims)
  return {
    providerId: value.sub,
    email: value.email ?? null,
    emailVerified: value.email_verified === true || value.email_verified === 'true',
  }
}
