import type { Prisma } from '../../../generated/prisma/client.js'
import type { AccessTokenPayload, TokenService } from '../token.service.js'

import { refreshSessionChanged } from './mfa-refresh-authority.js'

/** Caller holds the account lock. A credential leaves only after its retention write commits. */
export async function issueFamilyAccessToken(
  tx: Prisma.TransactionClient,
  tokens: TokenService,
  payload: AccessTokenPayload
): Promise<string> {
  const token = tokens.generateAccessToken(payload)
  if (payload.fid === undefined) return token
  const { exp, iat } = tokens.verifyAccessToken(token)
  if (!Number.isSafeInteger(exp) || !Number.isSafeInteger(iat) || exp! <= iat!)
    throw new Error('Family access token requires a bounded lifetime')
  const expiry = new Date(exp! * 1000)
  const lifetimeMs = (exp! - iat!) * 1000
  if (!Number.isFinite(expiry.getTime()) || !Number.isSafeInteger(lifetimeMs))
    throw new Error('Family access token lifetime is invalid')
  const count = await tx.$executeRaw`
    UPDATE core.auth_session_families
    SET "lastAccessIssuedAt" = GREATEST("lastAccessIssuedAt", clock_timestamp()),
        "retainUntil" = GREATEST("retainUntil", "expiresAt", ${expiry},
          clock_timestamp() + ${lifetimeMs} * interval '1 millisecond')
    WHERE id = ${payload.fid} AND "userId" = ${payload.sub}
      AND "securityVersion" = ${payload.securityVersion} AND "revokedAt" IS NULL`
  if (count !== 1) throw refreshSessionChanged()
  return token
}
