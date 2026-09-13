import { VAULT_TTL_SECONDS } from '@/shared/api/bff/vault-constants'

import 'server-only'

/** A host-only browser pointer to the isolated Operations Console vault. */
export const CONSOLE_SESSION_COOKIE_NAME = '__Host-amcore_console_session'

export function consoleSessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: true as const,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: VAULT_TTL_SECONDS,
  }
}
