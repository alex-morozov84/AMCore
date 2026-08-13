import { cookies } from 'next/headers'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'
import { forwardResponseHeaders } from './proxy-headers'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import type { VaultEntry } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'
import { upstreamRefresh } from './upstream-refresh'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const REFRESH_COOKIE_NAME = 'refresh_token'

/**
 * Dedicated handlers for `/auth/sessions*` (ADR-068, sessions-list slice) —
 * not the generic `authenticated-proxy.ts`, which deliberately never
 * forwards the browser's own cookies. The backend identifies the
 * "current" session by hashing the raw `refresh_token` cookie on its own
 * incoming request (`auth.controller.ts`), so every call here needs
 * **both** `Authorization: Bearer` and a `Cookie: refresh_token=...`
 * header built from the vault entry — the same shape `logout-handler.ts`
 * already established for this exact reason.
 */
async function getVaultEntryOrFailure(request: Request): Promise<VaultEntry | Response> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }

  try {
    return await ensureFreshSession(sessionId, {
      store: redisVaultStore,
      lock: redisVaultLock,
      upstreamRefresh,
    })
  } catch (error) {
    return authFailureResponse(request, error)
  }
}

function authHeaders(entry: VaultEntry): Headers {
  return new Headers({
    Authorization: `Bearer ${entry.accessToken}`,
    Cookie: `${REFRESH_COOKIE_NAME}=${entry.refreshToken}`,
  })
}

function relay(upstreamResponse: Response): Response {
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}

/** `GET /api/auth/sessions?page&limit` — safe method, no CSRF gate needed. */
export async function handleGetSessions(request: Request): Promise<Response> {
  const entry = await getVaultEntryOrFailure(request)
  if (entry instanceof Response) return entry

  const upstream = new URL(`${API_URL}/api/v1/auth/sessions`)
  upstream.search = new URL(request.url).search

  const upstreamResponse = await fetch(upstream, { headers: authHeaders(entry) })
  return relay(upstreamResponse)
}

/** `DELETE /api/auth/sessions/:sessionId` — state-changing, CSRF-gated. */
export async function handleDeleteSession(request: Request, sessionId: string): Promise<Response> {
  if (!isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const entry = await getVaultEntryOrFailure(request)
  if (entry instanceof Response) return entry

  const upstream = `${API_URL}/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`
  const upstreamResponse = await fetch(upstream, { method: 'DELETE', headers: authHeaders(entry) })
  return relay(upstreamResponse)
}

/** `DELETE /api/auth/sessions` (revoke all except current) — CSRF-gated. */
export async function handleDeleteOtherSessions(request: Request): Promise<Response> {
  if (!isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const entry = await getVaultEntryOrFailure(request)
  if (entry instanceof Response) return entry

  const upstreamResponse = await fetch(`${API_URL}/api/v1/auth/sessions`, {
    method: 'DELETE',
    headers: authHeaders(entry),
  })
  return relay(upstreamResponse)
}
