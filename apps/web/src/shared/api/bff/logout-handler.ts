import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { logoutBoundBrowserSession } from './backend-session-revocation'
import { changedBrowserContext, readBrowserCapability } from './browser-binding.server'
import {
  CONTEXT_SESSION_HEADER,
  contextSessionBinding,
  validateExpectedContextSession,
} from './context-session'
import { getCurrentVaultSession } from './current-session'
import { isTrustedOrigin } from './origin-guard'
import { isProductMutationTrusted, type ProductWebContext } from './product-web-context.server'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultStore } from './session-vault-store'

import 'server-only'

/** An observed session intent and exact primary generation must both match before cookie clearing. */
export async function handleLogout(
  request: Request,
  context?: ProductWebContext
): Promise<NextResponse> {
  if (
    !(context !== undefined ? isProductMutationTrusted(request, context) : isTrustedOrigin(request))
  ) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const cookieName = context?.cookieName ?? SESSION_COOKIE_NAME
  try {
    const selected = readBrowserCapability(request.headers, cookieName)
    if (selected) {
      const current = await getCurrentVaultSession(
        context?.store ?? redisVaultStore,
        cookieName,
        context?.audience ?? 'product'
      )
      if (!current || current.sessionId !== selected) throw changedBrowserContext()
      const expected = request.headers.get(CONTEXT_SESSION_HEADER) ?? undefined
      validateExpectedContextSession(expected)
      if (expected !== contextSessionBinding(current.sessionId, current.entry))
        throw changedBrowserContext()
      await logoutBoundBrowserSession(
        current.entry,
        request.headers,
        context?.audience ?? 'product'
      )
      await (context?.store ?? redisVaultStore).delete(current.sessionId).catch(() => {
        console.error('[bff] exact logged-out vault cleanup unavailable')
      })
    }
    const response = NextResponse.json({ message: 'Logged out' }, { status: 200 })
    // Server retirement makes the old handle inert. A delayed logout response
    // must not erase the primary handle from a newer published login.
    // The stable browser anchor is never rewritten. Old responses cannot restore authority.
    return response
  } catch (error) {
    return authFailureResponse(request, error)
  }
}
