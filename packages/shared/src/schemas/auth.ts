import { z } from 'zod'

// ===========================================
// Request Schemas
// ===========================================

/** Registration request */
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  name: z.string().min(2).optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>

/** Login request */
export const loginSchema = z.object({
  email: z.email(),
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
  email: z.email(),
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
  email: z.email(),
})

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>

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

/** Sessions list response */
export const sessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
})

export type SessionsResponse = z.infer<typeof sessionsResponseSchema>

/** Token refresh response */
export const refreshResponseSchema = z.object({
  accessToken: z.string(),
})

export type RefreshResponse = z.infer<typeof refreshResponseSchema>

/** Success message response */
export const messageResponseSchema = z.object({
  message: z.string(),
})

export type MessageResponse = z.infer<typeof messageResponseSchema>
