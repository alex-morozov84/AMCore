import { z } from 'zod'

import { mfaProofSchema } from './mfa'
import { passwordLoginPendingSchema } from './mfa-login'

/** Signed source-session authority selects the family; callers provide no family identifier. */
export const mfaSessionFlowInputSchema = z
  .object({
    purpose: z.enum(['reauthenticate', 'replace_factor', 'rotate_codes']),
    operationId: z.string().uuid(),
    proofWindowSeconds: z.number().int().min(1).max(600).optional(),
  })
  .strict()
export const mfaSessionFlowResultSchema = z.union([
  passwordLoginPendingSchema,
  z.object({ kind: z.literal('limited'), retryAfter: z.number().int().positive() }).strict(),
  z.object({ kind: z.enum(['restart_required', 'unavailable']) }).strict(),
])
export const mfaReauthenticationResultSchema = z.union([
  z
    .object({
      outcome: z.enum(['completed', 'proof_required']),
      requiredProofs: z.array(z.enum(['password', 'second_factor'])),
    })
    .strict(),
  z.object({ outcome: z.enum(['restart_required', 'unavailable']) }).strict(),
])

export const mfaStepUpPendingSchema = z
  .object({
    kind: z.literal('proof_required'),
    flowBinding: z.string().uuid(),
    expiresAt: z.iso.datetime(),
    requiredProofs: z.array(z.enum(['password', 'second_factor'])),
  })
  .strict()
export const mfaStepUpCommandSchema = z
  .object({
    flowBinding: z.string().uuid(),
    operationId: z.string().uuid(),
    proof: mfaProofSchema.optional(),
  })
  .strict()
export type MfaStepUpPending = z.infer<typeof mfaStepUpPendingSchema>
export type MfaStepUpCommand = z.infer<typeof mfaStepUpCommandSchema>
