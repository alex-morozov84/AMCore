import { createZodDto } from 'nestjs-zod'

import {
  authResponseSchema,
  avatarResponseSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  messageResponseSchema,
  oauthExchangeRequestSchema,
  oauthExchangeResponseSchema,
  oauthProvidersResponseSchema,
  profileResponseSchema,
  refreshResponseSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  stepUpSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@amcore/shared'

// Request DTOs
export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class OAuthExchangeDto extends createZodDto(oauthExchangeRequestSchema) {}
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
export class ResendVerificationDto extends createZodDto(resendVerificationSchema) {}
export class StepUpDto extends createZodDto(stepUpSchema) {}

// Response DTOs (Arc C — typed Swagger success surface). Used with
// `@ZodResponse` to keep run-time serialization, the TS return type, and the
// OpenAPI schema in sync.
export class AuthResponseDto extends createZodDto(authResponseSchema) {}
export class RefreshResponseDto extends createZodDto(refreshResponseSchema) {}
export class ProfileResponseDto extends createZodDto(profileResponseSchema) {}
export class AvatarResponseDto extends createZodDto(avatarResponseSchema) {}
export class MessageResponseDto extends createZodDto(messageResponseSchema) {}
export class OAuthProvidersResponseDto extends createZodDto(oauthProvidersResponseSchema) {}
export class OAuthExchangeResponseDto extends createZodDto(oauthExchangeResponseSchema) {}
