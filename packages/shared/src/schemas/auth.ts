import { z } from 'zod'

import { SUPPORTED_LOCALES, type SupportedLocale } from '../constants'

import { paginatedResponseSchema } from './pagination'

export const emailInputSchema = z.string().trim().pipe(z.email())

/**
 * Supported locale — derived from the single `SUPPORTED_LOCALES` source so
 * registration, profile update, the user response, and email rendering all
 * validate against the same set. No hardcoded messages (Zod v4 native i18n).
 */
export const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES)

/**
 * Parse a stored locale string (e.g. the Prisma `User.locale` column) into the
 * supported set. This is the boundary where a persisted value becomes the typed
 * public contract: an out-of-contract value throws rather than being silently
 * blessed, so invalid stored data surfaces instead of disagreeing with email/UI
 * support. Upstream only ever writes supported locales, so this never throws in
 * practice; a fork that stores others must extend the contract + migrate.
 */
export function parseSupportedLocale(value: string): SupportedLocale {
  return supportedLocaleSchema.parse(value)
}

/**
 * IANA time-zone identifier (e.g. `Europe/Moscow`, `UTC`). Validated structurally
 * via `Intl.DateTimeFormat`, which throws `RangeError` for an unknown zone — this
 * keeps the check language-agnostic and avoids shipping a static zone list that
 * drifts from the runtime's tz database. Available in both Node and the browser.
 *
 * Numeric UTC offsets (`+01:00`, `-0500`, `+23`) are rejected even though `Intl`
 * accepts them: the contract is a named IANA zone for a durable preference, not a
 * fixed offset that ignores DST. Offset identifiers always begin with `+`/`-`,
 * while every named zone/alias begins with a letter (`Etc/GMT+5` included).
 */
export const timezoneSchema = z.string().refine((tz) => {
  if (/^[+-]/.test(tz)) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
})

// ===========================================
// Request Schemas
// ===========================================

/** Registration request */
export const registerSchema = z.object({
  email: emailInputSchema,
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  name: z.string().min(2).optional(),
  // Optional explicit locale; when omitted the API falls back to
  // `Accept-Language` negotiation, then the DB default (see AuthService.register).
  locale: supportedLocaleSchema.optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>

/** Login request */
export const loginSchema = z.object({
  email: emailInputSchema,
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof loginSchema>

/** Profile update request */
export const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  locale: supportedLocaleSchema.optional(),
  timezone: timezoneSchema.optional(),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

/** Change password request */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

/** Forgot password request */
export const forgotPasswordSchema = z.object({
  email: emailInputSchema,
})

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

/** Reset password request */
export const resetPasswordSchema = z.object({
  token: z.string().length(64), // 64-char crypto token
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

/** Verify email request */
export const verifyEmailSchema = z.object({
  token: z.string().length(64), // 64-char crypto token
})

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>

/** Resend verification email request */
export const resendVerificationSchema = z.object({
  email: emailInputSchema,
})

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>

/** OAuth login ticket exchange request */
export const oauthExchangeRequestSchema = z.object({
  ticket: z.string().min(1),
})

export type OAuthExchangeRequest = z.infer<typeof oauthExchangeRequestSchema>

/**
 * Step-up re-authentication request (OB-06b / ADR-037).
 *
 * Just the current password — verified against the authenticated user to
 * refresh the current session's recent-auth window. `min(1)` only: this
 * verifies an existing credential, it does not set one, so the registration
 * complexity rules do not apply.
 */
export const stepUpSchema = z.object({
  password: z.string().min(1),
})

export type StepUpInput = z.infer<typeof stepUpSchema>

// ===========================================
// Response Schemas
// ===========================================

/** User response (safe, without password) */
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  phone: z.string().nullable(),
  // Reuses the single supported-locale source so the public response contract
  // matches what registration/profile accept (the mapper boundary parses the
  // stored Prisma string into this set — see AuthService.mapUserToResponse).
  locale: supportedLocaleSchema,
  timezone: z.string(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
})

export type UserResponse = z.infer<typeof userResponseSchema>

/** Auth response (login/register) */
export const authResponseSchema = z.object({
  user: userResponseSchema,
  accessToken: z.string(),
})

export type AuthResponse = z.infer<typeof authResponseSchema>

/** Session info */
export const sessionSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
  current: z.boolean(),
})

export type Session = z.infer<typeof sessionSchema>

/**
 * Sessions list response — paginated envelope (ADR-036 / OB-05).
 *
 * Previously `{ sessions: Session[] }`. Now `{ data, total, page, limit }`
 * to match the canonical envelope shared by every other list endpoint.
 * `apps/web/src/shared/api/auth-api.ts` and downstream UI consumers
 * switch to `body.data[i]` in the same stage.
 */
export const sessionsListResponseSchema = paginatedResponseSchema(sessionSchema)

export type SessionsListResponse = z.infer<typeof sessionsListResponseSchema>

/** Token refresh response */
export const refreshResponseSchema = z.object({
  accessToken: z.string(),
})

export type RefreshResponse = z.infer<typeof refreshResponseSchema>

/** OAuth login ticket exchange response */
export const oauthExchangeResponseSchema = z.object({
  accessToken: z.string(),
})

export type OAuthExchangeResponse = z.infer<typeof oauthExchangeResponseSchema>

/** Success message response */
export const messageResponseSchema = z.object({
  message: z.string(),
})

export type MessageResponse = z.infer<typeof messageResponseSchema>
