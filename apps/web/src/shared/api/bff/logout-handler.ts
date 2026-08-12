import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { type CurrentVaultSession, getCurrentVaultSession } from './current-session'
import { isTrustedOrigin } from './origin-guard'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultStore } from './session-vault-store'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const REFRESH_COOKIE_NAME = 'refresh_token'

/**
 * Logout is a **dedicated** handler, not routed through the generic
 * `authenticated-proxy.ts` — it needs the vault's raw refresh token to
 * present to the backend, and the generic proxy deliberately never forwards
 * any cookie (round 2 design decision: no per-path special case in the
 * generic proxy; auth endpoints that need the raw refresh token get their
 * own handler instead).
 *
 * Deliberately does **not** call `ensureFreshSession` — logging out has no
 * reason to refresh/rotate the token pair first.
 *
 * Partial-failure ordering (ADR-068, round 3): a trusted-origin logout
 * **always** clears the browser's `amcore_session` cookie and returns 200 —
 * whether the vault read, the backend logout call, or the vault delete
 * succeeds or fails. From the browser's point of view logout genuinely did
 * happen (the cookie really is gone) either way; every failure mode is
 * logged loudly server-side instead of surfacing an HTTP error the
 * frontend would have to explain for an action that, from where the
 * browser sits, unambiguously succeeded.
 */
export async function handleLogout(request: Request): Promise<NextResponse> {
  if (!isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const current = await readCurrentSessionSafely()
  if (current) {
    await Promise.all([
      callBackendLogout(current.entry.refreshToken),
      deleteVaultEntry(current.sessionId),
    ])
  }

  const response = NextResponse.json({ message: 'Logged out' }, { status: 200 })
  response.cookies.delete(SESSION_COOKIE_NAME)
  return response
}

/**
 * `getCurrentVaultSession` can throw (`SessionVaultUnavailableError` when
 * Redis is unreachable) — without this guard, that would abort
 * `handleLogout` before it ever reaches the cookie-clearing code below,
 * leaving the browser still holding a cookie after a "successful" logout
 * attempt. A vault read failure means there's nothing to clean up
 * server-side anyway; still log it distinctly from the two cleanup calls.
 */
async function readCurrentSessionSafely(): Promise<CurrentVaultSession | null> {
  try {
    return await getCurrentVaultSession()
  } catch (error) {
    console.error('[bff] reading the current session failed during logout', error)
    return null
  }
}

async function callBackendLogout(refreshToken: string): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}` },
    })
    // `fetch` only rejects on network-level failures — a non-2xx backend
    // response (500, 403, ...) resolves normally and was previously
    // silently ignored.
    if (!response.ok) {
      console.error(`[bff] backend logout call returned status ${response.status}`)
    }
  } catch (error) {
    console.error('[bff] backend logout call failed', error)
  }
}

async function deleteVaultEntry(sessionId: string): Promise<void> {
  try {
    await redisVaultStore.delete(sessionId)
  } catch (error) {
    // TTL is the last-resort cleanup if this itself fails — the browser
    // cookie is still cleared either way (see handleLogout).
    console.error('[bff] vault delete failed during logout', error)
  }
}
