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
  signupPolicyResponseSchema,
  stepUpSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

// Request DTOs
export class RegisterDto extends createSchemaDto(registerSchema) {}
export class LoginDto extends createSchemaDto(loginSchema) {}
export class OAuthExchangeDto extends createSchemaDto(oauthExchangeRequestSchema) {}
export class UpdateProfileDto extends createSchemaDto(updateProfileSchema) {}
export class ChangePasswordDto extends createSchemaDto(changePasswordSchema) {}
export class ForgotPasswordDto extends createSchemaDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createSchemaDto(resetPasswordSchema) {}
export class VerifyEmailDto extends createSchemaDto(verifyEmailSchema) {}
export class ResendVerificationDto extends createSchemaDto(resendVerificationSchema) {}
export class StepUpDto extends createSchemaDto(stepUpSchema) {}

// Response DTOs (Arc C — typed Swagger success surface). Used with
// `@SchemaResponse` to keep run-time serialization, the TS return type, and the
// OpenAPI schema in sync.
export class AuthResponseDto extends createSchemaDto(authResponseSchema) {}
export class RefreshResponseDto extends createSchemaDto(refreshResponseSchema) {}
export class ProfileResponseDto extends createSchemaDto(profileResponseSchema) {}
export class AvatarResponseDto extends createSchemaDto(avatarResponseSchema) {}
export class MessageResponseDto extends createSchemaDto(messageResponseSchema) {}
export class OAuthProvidersResponseDto extends createSchemaDto(oauthProvidersResponseSchema) {}
export class OAuthExchangeResponseDto extends createSchemaDto(oauthExchangeResponseSchema) {}

export class SignupPolicyResponseDto extends createSchemaDto(signupPolicyResponseSchema) {}
