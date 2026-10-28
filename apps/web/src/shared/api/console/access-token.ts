import { headers } from 'next/headers'
import type { UserResponse } from '@amcore/shared'

import { readBrowserCapability } from '@/shared/api/bff/browser-binding.server'
import { browserSessionHeaders } from '@/shared/api/bff/browser-binding.server'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import { getOptionalSession, getOptionalSessionEntry } from '@/shared/api/bff/dal'
import type { TokenResolver } from '@/shared/api/server'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { getConsoleSessionEntry } from './session'
import { CONSOLE_SESSION_COOKIE_NAME } from './session-cookie'

import 'server-only'

/**
 * The console's own token source: host mode has an isolated session vault
 * (ADR-081), path mode reuses the product session. Shared by every console
 * call into `apps/api` — never falls back across modes, and never touches
 * the product session in host mode.
 */
export const getConsoleAwareAccessToken: TokenResolver = async () => {
  const entry =
    ADMIN_CONSOLE_CONFIG.mode === 'host'
      ? await getConsoleSessionEntry()
      : await getOptionalSessionEntry('site-auth')
  return entry
    ? {
        accessToken: entry.accessToken,
        browserHeaders: browserSessionHeaders(
          await headers(),
          ADMIN_CONSOLE_CONFIG.mode === 'host' ? 'console' : 'product',
          entry
        ),
      }
    : null
}

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

/** Capture a nonsecret logout intent when rendering the page, never by selecting a later session at click time. */
export async function getConsoleLogoutIntent(): Promise<string | undefined> {
  const host = ADMIN_CONSOLE_CONFIG.mode === 'host'
  const entry = host ? await getConsoleSessionEntry() : await getOptionalSessionEntry('site-auth')
  const id = readBrowserCapability(
    await headers(),
    host ? CONSOLE_SESSION_COOKIE_NAME : 'amcore_session'
  )
  return entry && id ? contextSessionBinding(id, entry) : undefined
}
