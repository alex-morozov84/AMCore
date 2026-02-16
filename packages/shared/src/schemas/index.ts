// Schemas public API

// Auth schemas
export {
  // Request schemas
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  // Response schemas
  userResponseSchema,
  authResponseSchema,
  sessionSchema,
  sessionsResponseSchema,
  refreshResponseSchema,
  messageResponseSchema,
  // Types
  type RegisterInput,
  type LoginInput,
  type UpdateProfileInput,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
  type ResendVerificationInput,
  type UserResponse,
  type AuthResponse,
  type Session,
  type SessionsResponse,
  type RefreshResponse,
  type MessageResponse,
} from './auth'

// Backwards compatibility
export { userSchema, type User } from './user'
