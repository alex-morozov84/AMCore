import { z } from 'zod'

import type { PasswordChangedEmailData, WelcomeEmailData } from './email.types'
import { EmailTemplate } from './email.types'

/**
 * Runtime validation for queued email jobs (EQS-07).
 *
 * BullMQ deserializes job data from Redis as untyped JSON, so the
 * `SendEmailJobData` compile-time type is not a runtime guarantee. The
 * `EmailProcessor` validates against these schemas before rendering; a job that
 * fails is treated as a deterministic (`UnrecoverableError`) failure and is not
 * retried (EQS-03).
 *
 * Only the two non-secret, queueable templates are modelled — secret-bearing
 * templates are sent directly via `EmailService.sendNow` and must never be
 * enqueued (EQS-02). The discriminated union therefore also rejects a secret
 * template, but the processor's EQS-02 discard runs first by design so such a
 * job is dropped (completed), not failed-and-retained.
 *
 * Kept in `apps/api` (not `packages/shared`): this is an internal worker
 * contract, not a frontend wire contract.
 */

const localeSchema = z.enum(['ru', 'en'])

export const welcomeEmailDataSchema = z.object({
  name: z.string(),
  email: z.email(),
  locale: localeSchema.optional(),
}) satisfies z.ZodType<WelcomeEmailData>

export const passwordChangedEmailDataSchema = z.object({
  name: z.string(),
  changedAt: z.string(),
  loginUrl: z.string(),
  supportEmail: z.string(),
  locale: localeSchema.optional(),
}) satisfies z.ZodType<PasswordChangedEmailData>

/**
 * Discriminated union on `template`. `z.literal(EmailTemplate.X)` keeps the
 * inferred `template` as the enum member, so `SendEmailJobData['template']`
 * equals `QueueableEmailTemplate`.
 */
export const sendEmailJobDataSchema = z.discriminatedUnion('template', [
  z.object({
    template: z.literal(EmailTemplate.WELCOME),
    to: z.email(),
    data: welcomeEmailDataSchema,
  }),
  z.object({
    template: z.literal(EmailTemplate.PASSWORD_CHANGED),
    to: z.email(),
    data: passwordChangedEmailDataSchema,
  }),
])

/** BullMQ job data for sending a (non-secret) queued email. Single source of truth. */
export type SendEmailJobData = z.infer<typeof sendEmailJobDataSchema>
