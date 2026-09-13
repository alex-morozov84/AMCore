import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { revokeBackendSession } from '@/shared/api/bff/backend-session-revocation'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { isTrustedConsoleOrigin } from './origin-guard'
import { getCurrentConsoleSession } from './session'
import { CONSOLE_SESSION_COOKIE_NAME, consoleSessionCookieOptions } from './session-cookie'
import { redisConsoleVaultStore } from './session-vault-store'

import 'server-only'

export async function handleConsoleLogout(request: Request): Promise<Response> {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return new Response(null, { status: 404 })
  if (!isTrustedConsoleOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const current = await readConsoleSessionSafely()
  if (current) {
    await Promise.all([
      revokeBackendSession(current.entry.refreshToken),
      deleteConsoleVaultEntry(current.sessionId),
    ])
  }

  const response = new NextResponse(null, { status: 204 })
  response.cookies.set(CONSOLE_SESSION_COOKIE_NAME, '', {
    ...consoleSessionCookieOptions(),
    maxAge: 0,
  })
  return response
}

async function readConsoleSessionSafely() {
  try {
    return await getCurrentConsoleSession()
  } catch (error) {
    console.error('[console] session read failed during logout', error)
    return null
  }
}

async function deleteConsoleVaultEntry(sessionId: string): Promise<void> {
  try {
    await redisConsoleVaultStore.delete(sessionId)
  } catch (error) {
    console.error('[console] session delete failed during logout', error)
  }
}
