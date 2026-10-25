import { z } from 'zod'

import { mfaBackupCodesSchema, mfaCommandSchema, mfaSecretSchema, mfaStatusSchema } from './mfa'

/** Browser contracts deliberately exclude backend continuation and publication credentials. */
export const mfaBrowserViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unavailable') }).strict(),
  z.object({ kind: z.literal('password_setup_required'), accountLabel: z.string() }).strict(),
  z.object({ kind: z.literal('recovery_ticket'), accountLabel: z.string() }).strict(),
  z
    .object({
      kind: z.literal('settings'),
      accountLabel: z.string(),
      protected: z.boolean(),
      eligible: z.boolean(),
      remainingCodes: z.number().int().nonnegative(),
    })
    .strict(),
  mfaStatusSchema.extend({ kind: z.literal('flow'), accountLabel: z.string() }).strict(),
])

export const mfaBrowserActionSchema = z.enum([
  'start_setup',
  'confirm_password',
  'start_enrollment',
  'verify',
  'acknowledge_codes',
  'start_code_rotation',
  'rotate_codes',
  'recover_codes',
  'complete_login',
  'complete_confirmation',
  'start_replacement',
  'start_recovery',
  'redeem_recovery_ticket',
  'cancel',
])

export const mfaEmergencyProofSchema = z
  .object({
    password: z.string().min(1).max(128),
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
export const mfaBrowserCommandSchema = mfaCommandSchema
  .extend({
    action: mfaBrowserActionSchema,
    ticket: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .superRefine((command, context) => {
    if (command.action === 'redeem_recovery_ticket') {
      if (!command.password || !command.ticket || command.proof)
        context.addIssue({ code: 'custom' })
    } else if (command.ticket) context.addIssue({ code: 'custom' })
  })
export const mfaBrowserResultSchema = z
  .object({
    view: mfaBrowserViewSchema,
    enrollment: mfaSecretSchema.strict().optional(),
    backupCodes: mfaBackupCodesSchema.strict().optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.enrollment &&
        (result.view.kind !== 'flow' || result.view.state !== 'enrollment_required')) ||
      (result.backupCodes &&
        (result.view.kind !== 'flow' || result.view.state !== 'codes_pending')) ||
      (result.enrollment && result.backupCodes)
    )
      context.addIssue({ code: 'custom' })
  })

export type MfaBrowserView = z.infer<typeof mfaBrowserViewSchema>
export type MfaBrowserAction = z.infer<typeof mfaBrowserActionSchema>
export type MfaBrowserCommand = z.infer<typeof mfaBrowserCommandSchema>
export type MfaBrowserResult = z.infer<typeof mfaBrowserResultSchema>
