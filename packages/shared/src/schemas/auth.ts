import { z } from 'zod'

// ===========================================
// Request Schemas
// ===========================================

/** Registration request */
export const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .regex(/[A-Z]/, 'Минимум одна заглавная буква')
    .regex(/[0-9]/, 'Минимум одна цифра'),
  name: z.string().min(2, 'Минимум 2 символа').optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>

/** Login request */
export const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(1, 'Введите пароль'),
})

export type LoginInput = z.infer<typeof loginSchema>

/** Profile update request */
export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Минимум 2 символа').optional(),
  locale: z.enum(['ru', 'en']).optional(),
  timezone: z.string().optional(),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

/** Change password request */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: z
    .string()
    .min(8, 'Минимум 8 символов')
    .regex(/[A-Z]/, 'Минимум одна заглавная буква')
    .regex(/[0-9]/, 'Минимум одна цифра'),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

// ===========================================
// Response Schemas
// ===========================================

/** User response (safe, without password) */
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
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
  createdAt: z.string().datetime(),
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
