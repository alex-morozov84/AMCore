import type { JwtService } from '@nestjs/jwt'
import { z } from 'zod'

import { AuthErrorCode, SystemRole } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'

const claimsSchema = z.object({
  sub: z.string().min(1).max(128),
  sid: z.string().min(1).max(128),
  fid: z.string().min(1).max(128),
  securityVersion: z.number().int().nonnegative(),
  browserBound: z.literal(true).optional(),
  systemRole: z.enum([SystemRole.User, SystemRole.SuperAdmin]),
  exp: z.number().int().positive(),
})
type Purpose = 'browser_publication' | 'invitation_publication' | 'direct_mfa_receipt'

/** Signed identity proof ONLY. It is deliberately not a RequestPrincipal or CASL actor. */
export class PendingSessionProof {
  private constructor(
    readonly claims: Readonly<z.infer<typeof claimsSchema>>,
    readonly purpose: Purpose
  ) {}

  static verify(token: string, jwt: JwtService, purpose: Purpose): PendingSessionProof {
    try {
      if (typeof token !== 'string' || token.length > 8192) throw new Error('Invalid pending token')
      const claims = claimsSchema.parse(
        jwt.verify<Record<string, unknown>>(token, { algorithms: ['HS256'] })
      )
      const browserPurpose = purpose !== 'direct_mfa_receipt'
      if (browserPurpose !== (claims.browserBound === true))
        throw new Error('Wrong publication transport')
      return Object.freeze(new PendingSessionProof(Object.freeze(claims), purpose))
    } catch {
      throw new AppException('Invalid publication proof', 401, AuthErrorCode.TOKEN_INVALID)
    }
  }
}
