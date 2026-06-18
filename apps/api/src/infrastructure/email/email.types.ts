/**
 * Email Service Types & Interfaces
 *
 * Defines contracts for email providers and templates
 */

import type { Locale } from './messages'

/**
 * Email send parameters
 */
export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  /**
   * Idempotency key forwarded to the provider (EQS-03). Set by the email
   * processor to a value derived from the BullMQ job id so a retry after a
   * post-accept network blip does not double-send. Ignored by the mock provider.
   */
  idempotencyKey?: string
}

/**
 * Email send result
 */
export interface SendEmailResult {
  id: string
  success: boolean
  error?: string
  /**
   * Whether a failed send is worth retrying (EQS-03). The provider classifies
   * its error: deterministic config/payload errors → `false` (the processor
   * raises `UnrecoverableError`, no retry); transient/unknown → `true` (retry,
   * bounded by `attempts`, then dead-letter). Undefined on success.
   */
  retryable?: boolean
}

/**
 * Email provider interface
 *
 * All email providers (Resend, Mock) must implement this interface
 */
export interface EmailProvider {
  /**
   * Send an email
   */
  send(params: SendEmailParams): Promise<SendEmailResult>
}

/**
 * Email template data types
 */
export interface WelcomeEmailData {
  name: string
  email: string
  locale?: Locale
}

export interface PasswordResetEmailData {
  name: string
  resetUrl: string
  expiresIn: string
  locale?: Locale
}

export interface EmailVerificationData {
  name: string
  verificationUrl: string
  expiresIn: string
  locale?: Locale
}

export interface PasswordChangedEmailData {
  name: string
  changedAt: string
  loginUrl: string
  supportEmail: string
  locale?: Locale
}

/**
 * Org invite email data (OB-02).
 *
 * `hasAccount` flips the CTA between "Sign in to accept" (known user)
 * and "Create your account to join" (unknown email). The branch is
 * decided server-side at send time, not introspected from the token —
 * the recipient already knows their own account state, so the differ-
 * entiation leaks nothing.
 */
export interface OrgInviteEmailData {
  orgName: string
  inviterName: string
  inviterEmail: string
  roleName: string
  hasAccount: boolean
  acceptUrl: string
  expiresIn: string
  locale?: Locale
}

/**
 * Generic notification email (ADR-052). The `title`/`body` are already rendered and
 * localized by the dispatcher per the content policy (detailed vs neutral), so the
 * template only presents them — it never inspects a raw notification payload.
 * `actionUrl` (when present) is the trusted app base URL (`FRONTEND_URL`), never an
 * arbitrary URL from the notification.
 */
export interface NotificationEmailData {
  title: string
  body: string
  actionUrl?: string
  locale?: Locale
}

/**
 * Template name enum
 */
export enum EmailTemplate {
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password-reset',
  EMAIL_VERIFICATION = 'email-verification',
  PASSWORD_CHANGED = 'password-changed',
  ORG_INVITE = 'org-invite',
  NOTIFICATION = 'notification',
}

/**
 * Every template is renderable: `EmailService.renderTemplate` handles all five
 * and `sendNow` uses it for the secret-bearing ones.
 */
export type RenderableEmailTemplate = EmailTemplate

/** Data payload for any renderable template (used by `renderTemplate` / `sendNow`). */
export type RenderableEmailData =
  | WelcomeEmailData
  | PasswordResetEmailData
  | EmailVerificationData
  | PasswordChangedEmailData
  | OrgInviteEmailData
  | NotificationEmailData

/**
 * Templates that may be enqueued (EQS-02, Stage 2).
 *
 * Only non-secret templates are queueable. `PASSWORD_RESET`,
 * `EMAIL_VERIFICATION`, and `ORG_INVITE` carry a live token URL and must NEVER
 * be persisted in BullMQ/Redis/Bull Board — they go through
 * `EmailService.sendNow` (direct, in-process) instead. Narrowing
 * `SendEmailJobData` to this union makes "secrets are never enqueued" a
 * compile-time guarantee; `EmailService.queue` re-checks it at runtime for
 * callers that bypass TypeScript. See ADR-016 amendment 2026-05-29.
 */
export type QueueableEmailTemplate = EmailTemplate.WELCOME | EmailTemplate.PASSWORD_CHANGED

/** Runtime allowlist mirroring `QueueableEmailTemplate` for the `queue()` guard. */
export const QUEUEABLE_EMAIL_TEMPLATES: ReadonlySet<EmailTemplate> = new Set([
  EmailTemplate.WELCOME,
  EmailTemplate.PASSWORD_CHANGED,
])

/**
 * Secret-bearing templates (carry a live token URL). The email processor
 * discards a job with one of these (completes without render/send and without
 * dead-letter, so the token-bearing payload is not retained — EQS-02). Distinct
 * from "not queueable": a garbage/missing template is NOT in this set, so it
 * falls through to validation and is observably dead-lettered rather than
 * silently completed.
 */
export const SECRET_EMAIL_TEMPLATES: ReadonlySet<EmailTemplate> = new Set([
  EmailTemplate.PASSWORD_RESET,
  EmailTemplate.EMAIL_VERIFICATION,
  EmailTemplate.ORG_INVITE,
])

/**
 * BullMQ job data for sending a (non-secret) queued email.
 *
 * Derived from the Zod schema (`z.infer`) so the runtime validation and the
 * compile-time type cannot drift (EQS-03/EQS-07). Restricted to
 * `QueueableEmailTemplate` payloads.
 */
export type { SendEmailJobData } from './email.schema'
