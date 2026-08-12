import { extractCookieValue } from './set-cookie'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const REFRESH_COOKIE_NAME = 'refresh_token'

/** The backend's own `ApiErrorResponse` shape, forwarded verbatim (status + body). */
export class UpstreamAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`Upstream auth call failed with status ${status}`)
    this.name = 'UpstreamAuthError'
  }
}

export interface UpstreamAuthResult<TUser> {
  user: TUser
  accessToken: string
  refreshToken: string
}

/**
 * Calls `apps/api`'s credential auth endpoints (`/auth/login`,
 * `/auth/register`) server-side and extracts the `refresh_token` the
 * backend set via `Set-Cookie` — that value is what gets stored in the
 * Redis vault (ADR-068); it never reaches the browser in any form.
 * Forwards `Accept-Language` from the original browser request so the
 * backend's registration-locale negotiation (`negotiateLocale`) sees the
 * real browser preference instead of always falling back to its default.
 */
export async function callUpstreamAuth<TUser>(
  path: string,
  body: unknown,
  originalRequest?: Request
): Promise<UpstreamAuthResult<TUser>> {
  const acceptLanguage = originalRequest?.headers.get('accept-language')

  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new UpstreamAuthError(response.status, await safeJson(response))
  }

  const data = (await response.json()) as { user: TUser; accessToken: string }
  const refreshToken = extractCookieValue(response, REFRESH_COOKIE_NAME)
  if (!refreshToken) {
    throw new Error(`Upstream ${path} succeeded but did not set a ${REFRESH_COOKIE_NAME} cookie`)
  }

  return { user: data.user, accessToken: data.accessToken, refreshToken }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
