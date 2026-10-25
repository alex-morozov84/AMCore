import { cache } from 'react'
import { headers } from 'next/headers'
import { oauthProvidersResponseSchema } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import 'server-only'

const API_URL = getBackendBaseUrl()

/**
 * Server-side read of the backend's configured-OAuth-providers list
 * (`GET /auth/oauth/providers`, unauthenticated) — used to decide whether to
 * render the Google sign-in entry point at all, so the login/register pages
 * never show a dead button for a provider the operator hasn't configured.
 * `cache()`-wrapped so several Server Components on one render share a
 * single request. Fails open to `[]` (button hidden, not an error page) on
 * any network failure, non-2xx status, or unexpected body shape — this is a
 * cosmetic decision, never something worth failing the whole page render
 * over.
 */
export const getOAuthProviders = cache(async (): Promise<string[]> => {
  try {
    const response = await fetchBackendResponse(
      `${API_URL}/api/v1/auth/oauth/providers`,
      await headers()
    )
    if (!response.ok) return []

    const parsed = oauthProvidersResponseSchema.safeParse(await response.json())
    return parsed.success ? parsed.data.providers : []
  } catch {
    return []
  }
})
