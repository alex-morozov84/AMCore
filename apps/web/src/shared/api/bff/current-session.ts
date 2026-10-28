import { cookies, headers } from 'next/headers'
import type { BrowserAudience } from '@amcore/shared'

import { createBrowserBindingVerifier } from './browser-binding.server'
import { SESSION_COOKIE_NAME } from './session-cookie'
import type { VaultEntry, VaultStore } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

import 'server-only'

export interface CurrentVaultSession {
  sessionId: string
  entry: VaultEntry
}

/**
 * Reads `amcore_session` and the vault entry it points to, **without**
 * going through `ensureFreshSession` — no refresh, no rotation. For
 * handlers that need the raw stored refresh token as-is (logout, and later
 * the sessions-list/revoke handlers) rather than a guaranteed-fresh access
 * token. Returns `null` if there is no cookie or no matching vault entry
 * (already logged out, from this function's point of view).
 */
export async function getCurrentVaultSession(
  store: VaultStore = redisVaultStore,
  cookieName: string = SESSION_COOKIE_NAME,
  audience: BrowserAudience = 'product'
): Promise<CurrentVaultSession | null> {
  const sessionId = (await cookies()).get(cookieName)?.value
  if (!sessionId) return null

  const entry = await store.get(sessionId)
  if (!entry) return null
  await createBrowserBindingVerifier(await headers(), audience)(entry)

  return { sessionId, entry }
}
