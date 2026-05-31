import { z } from 'zod'

import { paginatedResponseSchema } from './pagination'

export const emailInputSchema = z.string().trim().pipe(z.email())

// ===========================================
// Request Schemas
// ===========================================

/** Registration request */
export const registerSchema = z.object({
  email: emailInputSchema,
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  name: z.string().min(2).optional(),
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
  locale: z.enum(['ru', 'en']).optional(),
  timezone: z.string().optional(),
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
  locale: z.string(),
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
