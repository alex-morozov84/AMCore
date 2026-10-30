import { z } from 'zod'

import { SystemRole } from '@amcore/shared'

// Prisma DateTime columns are UTC timestamp-without-time-zone; JSON does not add a zone.
const date = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`)
      : value,
  z.date()
)
const contextSchema = z.object({
  bindingHash: z.string(),
  audience: z.string(),
  id: z.string(),
  generation: z.number(),
  currentFamilyId: z.string().nullable(),
  state: z.string(),
  expiresAt: date,
})
const familySchema = z.object({
  id: z.string(),
  userId: z.string(),
  securityVersion: z.number(),
  expiresAt: date,
  revokedAt: date.nullable(),
  publicationState: z.string(),
  primaryMethod: z.string(),
  primaryAt: date.nullable(),
  primaryProofId: z.string().nullable(),
  mfaMethod: z.string().nullable(),
  mfaAt: date.nullable(),
  mfaProofId: z.string().nullable(),
  factorVersion: z.number().nullable(),
  browserContextId: z.string().nullable(),
  publicationGeneration: z.number().nullable(),
  browserContext: contextSchema.nullable(),
})
export const mfaPrimaryProjectionSchema = z.object({
  now: date,
  user: z.object({
    id: z.string(),
    systemRole: z.enum(SystemRole),
    mfaAccount: z
      .object({
        securityVersion: z.number(),
        required: z.boolean(),
        setupComplete: z.boolean(),
        emergencyRequired: z.boolean(),
      })
      .nullable(),
    mfaFactor: z.object({ version: z.number() }).nullable(),
  }),
  family: familySchema.nullable(),
  protocol: z.object({ state: z.string(), version: z.number() }).nullable(),
  session: z
    .object({
      id: z.string(),
      userId: z.string(),
      familyId: z.string(),
      expiresAt: date,
      revokedAt: date.nullable(),
      revocationReason: z.string().nullable(),
    })
    .nullable(),
})
export type MfaPrimaryProjection = z.infer<typeof mfaPrimaryProjectionSchema>
