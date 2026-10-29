import { z } from 'zod'

import { SystemRole } from '@amcore/shared'

export const mfaSourceSessionClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string(),
  systemRole: z.enum(SystemRole),
  sid: z.string().min(1),
  fid: z.string().min(1),
  securityVersion: z.number().int().nonnegative(),
  browserBound: z.literal(true).optional(),
  exp: z.number().int().positive(),
})
export type MfaSourceSessionClaims = z.infer<typeof mfaSourceSessionClaimsSchema>
