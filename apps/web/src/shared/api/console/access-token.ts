import type { UserResponse } from '@amcore/shared'

import { getOptionalSession, getOptionalSessionEntry } from '@/shared/api/bff/dal'
import type { TokenResolver } from '@/shared/api/server'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { getConsoleAccessToken, getConsoleSessionEntry } from './session'

import 'server-only'

/**
 * The console's own token source: host mode has an isolated session vault
 * (ADR-081), path mode reuses the product session. Shared by every console
 * call into `apps/api` — never falls back across modes, and never touches
 * the product session in host mode.
 */
export const getConsoleAwareAccessToken: TokenResolver = async () =>
  ADMIN_CONSOLE_CONFIG.mode === 'host'
    ? getConsoleAccessToken()
    : ((await getOptionalSessionEntry('site-auth'))?.accessToken ?? null)

/**
 * The signed-in operator's identity, for chrome only (initials, name) —
 * never an authorization decision. Same host/path split as the token
 * resolver above; `requireSuperAdmin()` already gates the page, so this is
 * purely presentational.
 */
export async function getConsoleAwareUser(): Promise<UserResponse | null> {
  if (ADMIN_CONSOLE_CONFIG.mode === 'host') {
    return (await getConsoleSessionEntry())?.userSnapshot ?? null
  }
  return (await getOptionalSession('site-auth'))?.user ?? null
}
