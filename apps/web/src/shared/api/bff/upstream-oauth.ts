import type { UserResponse } from '@amcore/shared'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/** The backend's own `ApiErrorResponse` shape, forwarded verbatim. */
export class UpstreamOAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`Upstream OAuth call failed with status ${status}`)
    this.name = 'UpstreamOAuthError'
  }
}

/**
 * `POST /auth/oauth/exchange` — unlike login/register, this does not set a
 * fresh `Set-Cookie`: the `refresh_token` was already minted and cookie-set
 * by the callback step (relayed onto the frontend's origin by
 * `oauth-provider-proxy.ts`). Exchange only *validates* it's present and
 * bound to the ticket's session (`oauth.controller.ts` `exchange()`), so the
 * caller must supply it explicitly as a `Cookie` header — server-side
 * `fetch` has no cookie jar of its own. Returns `{ accessToken }` only, no
 * `user` — callers need a separate `fetchCurrentUser` call.
 */
export async function callUpstreamOAuthExchange(
  ticket: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch(`${API_URL}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `refresh_token=${refreshToken}`,
    },
    body: JSON.stringify({ ticket }),
  })

  if (!response.ok) {
    throw new UpstreamOAuthError(response.status, await safeJson(response))
  }

  const data = (await response.json()) as { accessToken: string }
  return data.accessToken
}

/** `GET /auth/me` with the freshly-issued access token, for the vault's `userSnapshot`. */
export async function fetchCurrentUser(accessToken: string): Promise<UserResponse | null> {
  const response = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new UpstreamOAuthError(response.status, await safeJson(response))
  }

  const data = (await response.json()) as { user: UserResponse | null }
  return data.user
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
