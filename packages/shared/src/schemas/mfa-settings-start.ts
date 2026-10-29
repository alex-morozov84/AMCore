import { z } from 'zod'

import { mfaSessionFlowResultSchema } from './mfa-session-flow'

export const mfaSettingsStartInputSchema = z
  .object({
    operationId: z.string().uuid(),
    purpose: z.enum(['rotate_codes', 'replace_factor']),
    startNotAfter: z.iso.datetime(),
  })
  .strict()
export const mfaSettingsStartLookupSchema = mfaSettingsStartInputSchema
  .extend({ startNotAfter: z.iso.datetime().optional() })
  .strict()

export const mfaSettingsStartStatusSchema = z
  .object({
    state: z.enum(['not_found', 'created', 'abandoned', 'expired', 'advanced_unrecoverable']),
    flowId: z.string().uuid().optional(),
    expiresAt: z.iso.datetime().optional(),
    progressed: z.boolean().optional(),
  })
  .strict()

export const mfaSettingsStartResultSchema = z.union([
  mfaSessionFlowResultSchema,
  mfaSettingsStartStatusSchema,
])

export const mfaSettingsStartRecoverySchema = z
  .object({
    action: z.enum(['status', 'abandon']),
    operationId: z.string().uuid(),
    purpose: z.enum(['rotate_codes', 'replace_factor']),
  })
  .strict()

export type MfaSettingsStartInput = z.infer<typeof mfaSettingsStartInputSchema>
export type MfaSettingsStartLookup = z.infer<typeof mfaSettingsStartLookupSchema>
export type MfaSettingsStartStatus = z.infer<typeof mfaSettingsStartStatusSchema>
