import { createZodDto } from 'nestjs-zod'

import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  oauthExchangeRequestSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
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
