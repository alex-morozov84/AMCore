import { z } from 'zod'

export const mfaMethodSchema = z.enum(['totp', 'recovery_code'])
export const mfaPurposeSchema = z.enum([
  'login',
  'initial_setup',
  'reauthenticate',
  'replace_factor',
  'rotate_codes',
])
export const mfaProofSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('totp'), code: z.string().regex(/^\d{6}$/) }).strict(),
  z
    .object({
      method: z.literal('recovery_code'),
      code: z.string().regex(/^(?:[A-Fa-f0-9]{4}-){7}[A-Fa-f0-9]{4}$|^[A-Fa-f0-9]{32}$/),
    })
    .strict(),
])
export const mfaCommandSchema = z
  .object({
    operationId: z.string().uuid(),
    proof: mfaProofSchema.optional(),
    password: z.string().min(1).max(128).optional(),
    generation: z.number().int().positive().optional(),
  })
  .strict()
export const mfaFlowStateSchema = z.enum([
  'password_required',
  'enrollment_required',
  'verify_required',
  'codes_pending',
  'ready',
  'completed',
  'cancelled',
  'expired',
  'attempts_exhausted',
  'restart_required',
])
export const mfaStatusSchema = z.object({
  kind: z.literal('mfa'),
  state: mfaFlowStateSchema,
  purpose: mfaPurposeSchema,
  expiresAt: z.iso.datetime(),
  requiredProofs: z.array(z.enum(['password', 'second_factor'])),
  remainingCodes: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
})
export const mfaPendingSchema = mfaStatusSchema.extend({ continuation: z.string().min(43).max(43) })
export const mfaSecretSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
})
export const mfaBackupCodesSchema = z.object({
  codes: z.array(z.string()).length(10),
  generation: z.number().int().positive(),
})

export type MfaMethod = z.infer<typeof mfaMethodSchema>
export type MfaPurpose = z.infer<typeof mfaPurposeSchema>
export type MfaProof = z.infer<typeof mfaProofSchema>
export type MfaCommand = z.infer<typeof mfaCommandSchema>
export type MfaStatus = z.infer<typeof mfaStatusSchema>
export type MfaPending = z.infer<typeof mfaPendingSchema>
