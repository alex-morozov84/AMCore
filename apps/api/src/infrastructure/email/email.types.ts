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
}

/**
 * Email send result
 */
export interface SendEmailResult {
  id: string
  success: boolean
  error?: string
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
 * Template name enum
 */
export enum EmailTemplate {
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password-reset',
  EMAIL_VERIFICATION = 'email-verification',
  PASSWORD_CHANGED = 'password-changed',
  ORG_INVITE = 'org-invite',
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
 * BullMQ job data for sending emails. Restricted to non-secret
 * (`QueueableEmailTemplate`) payloads — see `QueueableEmailTemplate`.
 */
export interface SendEmailJobData {
  template: QueueableEmailTemplate
  to: string
  data: WelcomeEmailData | PasswordChangedEmailData
}
