import { z } from 'zod'

export const SUPPORT_MAIL_KINDS = ['email_verification', 'password_recovery'] as const
export const SUPPORT_MAIL_OUTCOMES = [
  'in_progress',
  'accepted',
  'simulated',
  'refused',
  'not_started',
  'unknown',
] as const
export const SUPPORT_MAIL_REASONS = [
  'deadline',
  'render_failed',
  'provider_failure',
  'auth',
  'invalid_sender',
  'invalid_request',
  'rate_limit',
  'quota',
  'superseded',
  'admission_changed',
  'precheck',
  'expired',
  'unavailable',
] as const
export const supportMailKindSchema = z.enum(SUPPORT_MAIL_KINDS)
export const supportMailAttemptIdSchema = z.uuid()
export const supportMailPrepareSchema = z.strictObject({ kind: supportMailKindSchema })
const instant = z.iso.datetime()
export const supportMailPreparationSchema = z.strictObject({
  attemptId: supportMailAttemptIdSchema,
  kind: supportMailKindSchema,
  recipient: z.email(),
  expiresAt: instant,
  linkLifetimeSeconds: z.number().int().positive(),
})
const fact = z.strictObject({
  evidence: z.enum(['stored', 'derived']),
  attemptId: supportMailAttemptIdSchema,
  kind: supportMailKindSchema,
  outcome: z.enum(SUPPORT_MAIL_OUTCOMES),
  tokenIssued: z.boolean(),
  provider: z.enum(['resend', 'mock']),
  reason: z.enum(SUPPORT_MAIL_REASONS).nullable(),
  attemptedAt: instant,
  settledAt: instant.nullable(),
  readUntil: instant,
})
export const supportMailReceiptSchema = z.discriminatedUnion('evidence', [
  fact,
  z.strictObject({
    evidence: z.literal('unconfirmed'),
    attemptId: supportMailAttemptIdSchema,
    tokenIssued: z.boolean().optional(),
  }),
])
export const supportMailActionSchema = z.strictObject({
  kind: supportMailKindSchema,
  available: z.boolean(),
  unavailableReason: z
    .enum([
      'already_verified',
      'no_password',
      'mock_in_production',
      'transport_unavailable',
      'cooldown',
      'limit',
    ])
    .nullable(),
  retryAfterSeconds: z.number().int().nonnegative(),
  latest: fact.nullable(),
  resultExpired: z.boolean(),
})
export const supportMailStatusSchema = z.strictObject({
  serverNow: instant,
  provider: z.enum(['resend', 'mock']),
  actions: z.array(supportMailActionSchema).length(2),
})
export type SupportMailKind = z.infer<typeof supportMailKindSchema>
export type SupportMailPreparation = z.infer<typeof supportMailPreparationSchema>
export type SupportMailReceipt = z.infer<typeof supportMailReceiptSchema>
export type SupportMailFact = z.infer<typeof fact>
export type SupportMailAction = z.infer<typeof supportMailActionSchema>
export type SupportMailStatus = z.infer<typeof supportMailStatusSchema>
