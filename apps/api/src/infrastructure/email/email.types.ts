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

/**
 * Template name enum
 */
export enum EmailTemplate {
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password-reset',
  EMAIL_VERIFICATION = 'email-verification',
}

/**
 * BullMQ job data for sending emails
 */
export interface SendEmailJobData {
  template: EmailTemplate
  to: string
  data: WelcomeEmailData | PasswordResetEmailData | EmailVerificationData
}
