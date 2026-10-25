import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { revokeBackendSession } from './backend-session-revocation'
import { type CurrentVaultSession, getCurrentVaultSession } from './current-session'
import { retireFlowsForOrdinaryAuth } from './invitation-auth-lifecycle'
import { isTrustedOrigin } from './origin-guard'
import { isProductMutationTrusted, type ProductWebContext } from './product-web-context.server'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultStore } from './session-vault-store'

import 'server-only'

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
export async function handleLogout(
  request: Request,
  context?: ProductWebContext
): Promise<NextResponse> {
  if (
    !(context?.frontend === 'admin'
      ? isProductMutationTrusted(request, context)
      : isTrustedOrigin(request))
  ) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const current = await readCurrentSessionSafely(context)
  if (current) {
    await Promise.all([
      revokeBackendSession(current.entry.refreshToken, request.headers),
      deleteVaultEntry(current.sessionId, context),
    ])
  }

  const response = NextResponse.json({ message: 'Logged out' }, { status: 200 })
  try {
    await retireFlowsForOrdinaryAuth(request, null, undefined, context)
  } catch {
    // Without the owner proof, a journal that could not be retired cannot authorize this browser.
    const scopes = context?.audience === 'staff' ? ['admin'] : ['site', 'admin']
    for (const scope of scopes) {
      const stem = scope === 'admin' ? 'amcore_admin_invite_browser' : 'amcore_invite_browser'
      for (const secure of [true, false])
        response.cookies.set(secure ? `__Host-${stem}` : `${stem}_local`, '', {
          secure,
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 0,
        })
    }
    console.error('[bff] invitation retirement unavailable during logout')
  }
  if (context?.audience === 'staff')
    response.cookies.set(context.cookieName, '', { ...context.cookieOptions, maxAge: 0 })
  else response.cookies.delete(context?.cookieName ?? SESSION_COOKIE_NAME)
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
async function readCurrentSessionSafely(
  context?: ProductWebContext
): Promise<CurrentVaultSession | null> {
  try {
    return context
      ? await getCurrentVaultSession(context.store, context.cookieName)
      : await getCurrentVaultSession()
  } catch {
    console.error('[bff] reading the current session failed during logout')
    return null
  }
}

async function deleteVaultEntry(sessionId: string, context?: ProductWebContext): Promise<void> {
  try {
    await (context?.store ?? redisVaultStore).delete(sessionId)
  } catch {
    // TTL is the last-resort cleanup if this itself fails — the browser
    // cookie is still cleared either way (see handleLogout).
    console.error('[bff] vault delete failed during logout')
  }
}
