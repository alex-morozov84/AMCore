import {
  type OAuthExchangeResponse,
  oauthExchangeResponseSchema,
  profileResponseSchema,
  type UserResponse,
} from '@amcore/shared'

import { invitationBackend, InvitationBackendError } from './invitation-upstream'

import 'server-only'

/** Safe classification only: upstream diagnostics may contain credential material. */
export class UpstreamOAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown = null
  ) {
    super(`Upstream OAuth call failed with status ${status}`)
    this.name = 'UpstreamOAuthError'
  }
}

async function containOAuth<T>(work: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await work()).data
  } catch (error) {
    throw new UpstreamOAuthError(error instanceof InvitationBackendError ? error.status : 503)
  }
}

/** Keep exact invitation correlation until publication; never project backend tokens to the browser. */
export function callUpstreamOAuthExchange(
  ticket: string,
  refreshToken: string,
  source = new Headers(),
  signal = AbortSignal.timeout(15000)
): Promise<OAuthExchangeResponse> {
  return containOAuth(() =>
    invitationBackend('/auth/oauth/exchange', oauthExchangeResponseSchema, {
      source,
      signal,
      method: 'POST',
      expectedStatus: 200,
      body: { ticket },
      refreshToken,
    })
  )
}

export async function fetchCurrentUser(
  accessToken: string,
  source = new Headers(),
  signal = AbortSignal.timeout(10000)
): Promise<UserResponse | null> {
  const data = await containOAuth(() =>
    invitationBackend('/auth/me', profileResponseSchema, {
      source,
      signal,
      method: 'GET',
      expectedStatus: 200,
      accessToken,
    })
  )
  return data.user
}
