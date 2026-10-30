import { z } from 'zod'

import { authResponseSchema } from './auth'
import { browserAudienceSchema, browserRevisionSchema } from './browser-publication'
import { productAdminReturnSchema } from './frontend-context'
import { mfaPendingSchema, mfaProofSchema, mfaPurposeSchema } from './mfa'

/** Private API/BFF and independent API-client contracts. Never forward credentials into browser JSON. */
export const loginPublicationSchema = z
  .object({
    continuation: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    operationId: z.string().uuid(),
    receipt: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
    familyId: z.string().min(1).max(128),
    securityVersion: z.number().int().nonnegative(),
    browser: browserRevisionSchema.extend({ audience: browserAudienceSchema }).strict().nullable(),
  })
  .strict()
export const passwordLoginResponseSchema = authResponseSchema
  .extend({ publication: loginPublicationSchema.optional() })
  .strict()
export const passwordLoginPendingSchema = mfaPendingSchema
  .extend({
    accountLabel: z.string().max(320).optional(),
    returnTo: productAdminReturnSchema.optional(),
    nextAction: z.enum(['verify', 'enroll', 'recovery_ticket', 'complete']),
    browser: browserRevisionSchema.nullable(),
  })
  .strict()

export type LoginPublication = z.infer<typeof loginPublicationSchema>
export type PasswordLoginResponse = z.infer<typeof passwordLoginResponseSchema>
export type PasswordLoginPending = z.infer<typeof passwordLoginPendingSchema>

/** Private BFF proposal; account creation supplies independent password authority. */
export const registrationPublicationIntentSchema = loginPublicationSchema
  .pick({ continuation: true, operationId: true })
  .extend({ vaultBinding: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict()
export type RegistrationPublicationIntent = z.infer<typeof registrationPublicationIntentSchema>

export const mfaOperationInputSchema = z
  .object({
    purpose: mfaPurposeSchema,
    operationId: z.string().uuid(),
  })
  .strict()
export const mfaVerifyInputSchema = mfaOperationInputSchema
  .extend({ proof: mfaProofSchema })
  .strict()
export const mfaPasswordInputSchema = mfaOperationInputSchema
  .extend({ password: z.string().min(1).max(128) })
  .strict()
export const mfaPasswordResultSchema = z
  .object({
    outcome: z.enum([
      'verified',
      'wrong_password',
      'password_setup_required',
      'proof_required',
      'restart_required',
      'unavailable',
    ]),
    requiredProofs: z.array(z.enum(['password', 'second_factor'])).optional(),
  })
  .strict()
export const mfaCompleteInputSchema = mfaOperationInputSchema
  .extend({
    vaultBinding: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
  })
  .strict()
export const mfaVerificationResultSchema = z
  .object({
    outcome: z.enum([
      'verified',
      'proof_required',
      'wrong_code',
      'attempts_exhausted',
      'restart_required',
      'unavailable',
      'limited',
    ]),
    requiredProofs: z.array(z.enum(['password', 'second_factor'])).optional(),
    retryAfter: z.number().int().positive().optional(),
  })
  .strict()
export const publicationStatusSchema = z
  .object({
    state: z.enum(['pending', 'published', 'expired', 'retired', 'changed']),
    familyId: z.string().min(1).max(128).optional(),
  })
  .strict()
export const mfaIssuanceOutcomeSchema = z.union([
  z.object({ kind: z.literal('issued'), status: publicationStatusSchema }).strict(),
  z
    .object({
      kind: z.literal('proof_required'),
      requiredProofs: z.array(z.enum(['password', 'second_factor'])),
    })
    .strict(),
  z.object({ kind: z.enum(['enrollment_required', 'restart_required', 'unavailable']) }).strict(),
])
export const publicationAcknowledgeInputSchema = mfaCompleteInputSchema
  .extend({
    accessToken: z.string().min(1).max(8192),
    receipt: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
  })
  .strict()
export const publicationAcknowledgedSchema = z.object({ outcome: z.literal('published') }).strict()

/** Restricted combined confirmation; this proves one handoff and never grants membership. */
export const invitationPublicationInputSchema = publicationAcknowledgeInputSchema
  .extend({
    handoff: z
      .object({
        attemptId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
        cleanupKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict(),
  })
  .strict()
