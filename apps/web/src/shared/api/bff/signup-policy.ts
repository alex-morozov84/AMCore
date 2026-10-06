import { cache } from 'react'
import { signupPolicyResponseSchema } from '@amcore/shared'

import { degradeSecondary, fetchBackend } from '../server'

import 'server-only'

/** Unknown policy hides public signup without disabling existing-account sign-in. */
export const getPublicSignupPolicy = cache(async (): Promise<boolean | null> => {
  const outcome = degradeSecondary(
    await fetchBackend('/api/v1/auth/signup-policy', signupPolicyResponseSchema, {
      auth: 'none',
      cache: 'no-store',
      timeoutMs: 10000,
    }),
    { source: 'public-signup-policy' }
  )
  return outcome.status === 'available' ? outcome.data.publicSignupEnabled : null
})
