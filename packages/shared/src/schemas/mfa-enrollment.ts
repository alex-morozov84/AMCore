import { z } from 'zod'

import { browserRevisionSchema } from './browser-publication'
import { mfaBackupCodesSchema, mfaSecretSchema } from './mfa'
import { mfaEmergencyProofSchema } from './mfa-browser'
import { mfaOperationInputSchema } from './mfa-login'

const proofRequired = z
  .object({
    outcome: z.literal('proof_required'),
    requiredProofs: z.array(z.enum(['password', 'second_factor'])),
  })
  .strict()
const limited = z
  .object({ outcome: z.literal('limited'), retryAfter: z.number().int().positive() })
  .strict()
const unavailable = z
  .object({
    outcome: z.enum([
      'restart_required',
      'unavailable',
      'wrong_code',
      'attempts_exhausted',
      'already_bound',
      'draft_exists',
      'generation_changed',
    ]),
  })
  .strict()

export const mfaEnrollmentInputSchema = mfaOperationInputSchema
  .extend({ regenerate: z.boolean().default(false) })
  .strict()
export const mfaEnrollmentResultSchema = z.union([
  z
    .object({
      outcome: z.literal('seed'),
      enrollment: mfaSecretSchema.strict(),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
  proofRequired,
  limited,
  unavailable,
])
/** Private API/BFF transfer. Only the backup set and nonsecret status may reach browser JSON. */
const setupSuccessorSchema = z
  .object({
    continuation: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    purpose: z.literal('initial_setup'),
    browser: browserRevisionSchema.nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
export const mfaFactorBindingResultSchema = z.union([
  z
    .object({
      outcome: z.literal('bound'),
      successor: setupSuccessorSchema
        .extend({ backupCodes: mfaBackupCodesSchema.strict() })
        .strict(),
    })
    .strict(),
  proofRequired,
  limited,
  unavailable,
])
export const mfaCodesAcknowledgementInputSchema = mfaOperationInputSchema
  .extend({ generation: z.number().int().positive() })
  .strict()
export const mfaCodesAcknowledgementResultSchema = z.union([
  z
    .object({ outcome: z.literal('acknowledged'), generation: z.number().int().positive() })
    .strict(),
  proofRequired,
  unavailable,
])
export const mfaSetupCodesResultSchema = z.union([
  z.object({ outcome: z.literal('codes'), backupCodes: mfaBackupCodesSchema.strict() }).strict(),
  z
    .object({ outcome: z.literal('already_generated'), generation: z.number().int().positive() })
    .strict(),
  proofRequired,
  limited,
  unavailable,
])
export type MfaFactorBindingResult = z.infer<typeof mfaFactorBindingResultSchema>

export const mfaRecoveryTicketInputSchema = mfaOperationInputSchema
  .extend(mfaEmergencyProofSchema.shape)
  .strict()
export const mfaRecoveryTicketResultSchema = z.union([
  z.object({ outcome: z.literal('enrollment'), successor: setupSuccessorSchema }).strict(),
  z
    .object({
      outcome: z.enum([
        'wrong_password',
        'wrong_ticket',
        'attempts_exhausted',
        'restart_required',
        'unavailable',
      ]),
    })
    .strict(),
  limited,
])
export type MfaRecoveryTicketResult = z.infer<typeof mfaRecoveryTicketResultSchema>
