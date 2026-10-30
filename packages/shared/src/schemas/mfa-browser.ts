import { z } from 'zod'

import { SUPPORTED_LOCALES } from '../constants'

import { productAdminReturnSchema } from './frontend-context'
import { invitationFlowIdSchema } from './invitation-flow'
import { mfaBackupCodesSchema, mfaCommandSchema, mfaSecretSchema, mfaStatusSchema } from './mfa'

export const consoleReturnDestinationSchema = z
  .object({
    href: z
      .string()
      .startsWith('/')
      .refine((value) => !value.startsWith('//')),
    locale: z.enum(SUPPORTED_LOCALES),
  })
  .strict()

export const mfaSettingsViewSchema = z
  .object({
    kind: z.literal('settings'),
    contextSession: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    accountLabel: z.string(),
    protected: z.boolean(),
    eligible: z.boolean(),
    remainingCodes: z.number().int().nonnegative(),
  })
  .strict()

/** Browser contracts deliberately exclude backend continuation and publication credentials. */
export const mfaBrowserViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unavailable') }).strict(),
  z
    .object({
      kind: z.literal('settings_start'),
      state: z.enum(['abandoned', 'advanced_unrecoverable']),
      operationId: z.string().uuid(),
      purpose: z.enum(['rotate_codes', 'replace_factor']),
      accountLabel: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('password_setup_required'),
      accountLabel: z.string(),
      flowBinding: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('recovery_ticket'),
      accountLabel: z.string(),
      flowBinding: z.string().uuid().optional(),
    })
    .strict(),
  mfaSettingsViewSchema,
  mfaStatusSchema
    .extend({
      kind: z.literal('flow'),
      invitationFlowId: invitationFlowIdSchema.optional(),
      returnTo: productAdminReturnSchema.optional(),
      publication: z.literal('confirmed').optional(),
      consoleReturn: consoleReturnDestinationSchema.optional(),
      accountLabel: z.string(),
      flowBinding: z.string().uuid().optional(),
    })
    .strict(),
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
  'settle_login',
  'reconcile_login',
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
    flowBinding: z.string().uuid().optional(),
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
export const mfaBrowserSignInPendingSchema = z
  .object({ kind: z.literal('mfa'), flowBinding: z.string().uuid() })
  .strict()
export type MfaBrowserSignInPending = z.infer<typeof mfaBrowserSignInPendingSchema>
