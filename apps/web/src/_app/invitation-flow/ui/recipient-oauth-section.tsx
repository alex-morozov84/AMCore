import { oauthProvidersResponseSchema } from '@amcore/shared'

import type { OAuthActionProvider } from '@/features/auth-oauth'
import { degradeSecondary, fetchBackend } from '@/shared/api/server'

import { RecipientOAuthOptions } from './recipient-oauth-scope'

import 'server-only'

/** Public options stream independently; provider failure never owns password entry. */
export async function RecipientOAuthSection() {
  const outcome = degradeSecondary(
    await fetchBackend('/api/v1/auth/oauth/providers', oauthProvidersResponseSchema, {
      auth: 'none',
      cache: 'no-store',
      timeoutMs: 5000,
    }),
    { source: 'invitation-oauth-options' }
  )
  if (outcome.status === 'degraded') return null
  const providers = outcome.data.providers.filter(
    (provider): provider is OAuthActionProvider =>
      provider === 'google' || provider === 'github' || provider === 'apple'
  )
  return <RecipientOAuthOptions providers={providers} />
}
