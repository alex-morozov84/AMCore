import { coerceSupportedLocale, frontendAuthPath, localizedFrontendUrl } from '@amcore/shared'

import type { EnvService } from '../../env/env.service.js'
import type { User } from '../../generated/prisma/client.js'
import type { EmailVerificationData, WelcomeEmailData } from '../../infrastructure/email/index.js'
import {
  type BrowserFrontendContext,
  resolveFrontendPlacement,
} from '../frontend-context/frontend-placement.js'

/** Everything the two registration emails need, resolved before the account commits. */
export interface RegistrationMail {
  welcome: WelcomeEmailData
  verification: EmailVerificationData
}

/**
 * Pure preparation (env + values, no I/O). Run it inside the registration transaction:
 * a configuration failure then rolls the account back instead of leaving an account whose
 * verification link cannot be built. The token comes from the same transaction, so no
 * second token is ever issued. Nothing is sent from here.
 */
export function prepareRegistrationMail(
  env: EnvService,
  user: User,
  verificationToken: string,
  frontend?: BrowserFrontendContext
): RegistrationMail {
  const locale = coerceSupportedLocale(user.locale)
  const name = user.name ?? user.email
  const verificationUrl = localizedFrontendUrl(
    frontend?.frontend === 'admin' ? resolveFrontendPlacement(env).admin : env.get('FRONTEND_URL'),
    locale,
    frontendAuthPath(frontend?.frontend ?? 'site', '/verify-email'),
    { token: verificationToken }
  )
  return {
    welcome: { name, email: user.email, locale },
    verification: {
      name,
      verificationUrl,
      expiresInHours: Number(env.get('EMAIL_VERIFICATION_EXPIRY_HOURS')),
      locale,
    },
  }
}
