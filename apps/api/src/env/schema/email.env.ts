import { z } from 'zod'

import { optionalEnvString } from './helpers'

// Email delivery + link/token lifetimes. The composed refinement requires
// RESEND_API_KEY when EMAIL_PROVIDER=resend.
export const emailEnv = z.object({
  EMAIL_PROVIDER: z.enum(['resend', 'mock']).default('mock'),
  RESEND_API_KEY: optionalEnvString(),
  EMAIL_FROM: z.email().default('noreply@amcore.com'),
  SUPPORT_EMAIL: z.email().default('support@amcore.com'),
  // Frontend base URL (for email links).
  FRONTEND_URL: z.url().default('http://localhost:3002'),
  PASSWORD_RESET_EXPIRY_MINUTES: z.coerce.number().int().min(1).default(15),
  EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce.number().int().min(1).default(48),
})
