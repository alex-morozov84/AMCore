import { authResponseSchema, type UserResponse } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import type { ProductWebContext } from './product-web-context.server'
import { sessionMetadataHeaders } from './session-metadata-headers'
import { extractCookieValue } from './set-cookie'

import 'server-only'

const API_URL = getBackendBaseUrl()
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
 * Forwards the browser's User-Agent so credential-created sessions show
 * the visitor's device instead of the server-side fetch identity.
 */
export async function callUpstreamAuth<TUser>(
  path: string,
  body: unknown,
  originalRequest: Request,
  context?: ProductWebContext
): Promise<UpstreamAuthResult<TUser>> {
  const response = await postUpstream(path, body, originalRequest, context)

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

/**
 * Outcome of the explicit registration call. `created` is the only evidence that
 * the account exists: the API answered exactly `201` AND the body is a valid auth
 * response. Anything else that arrives as a success (200/202/204, `201` with an
 * unusable body) is `unknown` — the BFF must not claim the account was created.
 * `refreshToken` is read from the headers BEFORE the body so cleanup can still
 * revoke the session when the body is unusable; it is server-only and never put
 * in an error or a log.
 */
export type UpstreamRegisterResult =
  | { outcome: 'created'; user: UserResponse; accessToken: string; refreshToken: string | null }
  | { outcome: 'unknown'; refreshToken: string | null }

/** Same transport and failures as `callUpstreamAuth`, but classifies creation evidence. */
export async function callUpstreamRegister(
  path: string,
  body: unknown,
  originalRequest: Request,
  context?: ProductWebContext
): Promise<UpstreamRegisterResult> {
  const response = await postUpstream(path, body, originalRequest, context)
  if (!response.ok) throw new UpstreamAuthError(response.status, await safeJson(response))

  const refreshToken = extractCookieValue(response, REFRESH_COOKIE_NAME)
  if (response.status !== 201) return { outcome: 'unknown', refreshToken }
  const parsed = authResponseSchema.safeParse(await safeJson(response))
  if (!parsed.success) return { outcome: 'unknown', refreshToken }
  return {
    outcome: 'created',
    user: parsed.data.user,
    accessToken: parsed.data.accessToken,
    refreshToken,
  }
}

async function postUpstream(
  path: string,
  body: unknown,
  originalRequest: Request,
  context?: ProductWebContext
): Promise<Response> {
  const acceptLanguage = originalRequest.headers.get('accept-language')

  return fetchBackendResponse(`${API_URL}/api/v1${path}`, originalRequest.headers, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
      ...sessionMetadataHeaders(originalRequest.headers),
      ...context?.apiHeaders,
    },
    body: JSON.stringify(body),
  })
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
