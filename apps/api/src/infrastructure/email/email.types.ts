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
 *
 * Stage B reserves this interface for type-completeness; the template
 * implementation and the actual queue wiring inside
 * `InviteService.createInvite` land together in Stage D so a deployed
 * job never hits a missing `renderTemplate` case.
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

export type RenderableEmailTemplate = Exclude<EmailTemplate, EmailTemplate.ORG_INVITE>

/**
 * BullMQ job data for sending emails
 *
 * `OrgInviteEmailData` is deliberately not in this union yet — Stage B
 * reserves the enum value and the interface, but the queue dispatch
 * wiring (and the matching `renderTemplate` case) land in Stage D so
 * the worker never sees an unrenderable job. TypeScript enforces the
 * gap: any premature `EmailService.queue({ template: ORG_INVITE, ... })`
 * call fails to type-check until Stage D widens this union.
 */
export interface SendEmailJobData {
  template: RenderableEmailTemplate
  to: string
  data: WelcomeEmailData | PasswordResetEmailData | EmailVerificationData | PasswordChangedEmailData
}
