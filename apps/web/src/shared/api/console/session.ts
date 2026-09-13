import { randomBytes } from 'node:crypto'

import { cache } from 'react'
import { cookies } from 'next/headers'
import type { UserResponse } from '@amcore/shared'

import { ensureFreshSession } from '@/shared/api/bff/ensure-fresh-session'
import type { VaultEntry } from '@/shared/api/bff/session-vault.types'
import { upstreamRefresh } from '@/shared/api/bff/upstream-refresh'
import { ACCESS_TOKEN_LIFETIME_MS } from '@/shared/api/bff/vault-constants'

import { CONSOLE_SESSION_COOKIE_NAME } from './session-cookie'
import { redisConsoleVaultLock } from './session-lock'
import { redisConsoleVaultStore } from './session-vault-store'

import 'server-only'

export const CONSOLE_AUDIENCE = 'console'

export interface ConsoleVaultEntry extends VaultEntry {
  audience: typeof CONSOLE_AUDIENCE
}

export interface ConsoleSessionParams {
  accessToken: string
  refreshToken: string
  user: UserResponse
}

function isConsoleVaultEntry(entry: VaultEntry): entry is ConsoleVaultEntry {
  return (entry as Partial<ConsoleVaultEntry>).audience === CONSOLE_AUDIENCE
}

export async function mintConsoleSession({
  accessToken,
  refreshToken,
  user,
}: ConsoleSessionParams): Promise<string> {
  const sessionId = randomBytes(32).toString('base64url')
  await redisConsoleVaultStore.create(sessionId, {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_MS,
    userSnapshot: user,
    audience: CONSOLE_AUDIENCE,
  } as Omit<ConsoleVaultEntry, 'version'>)
  return sessionId
}

export const getConsoleSessionEntry = cache(async (): Promise<ConsoleVaultEntry | null> => {
  const sessionId = (await cookies()).get(CONSOLE_SESSION_COOKIE_NAME)?.value
  if (!sessionId) return null

  const entry = await ensureFreshSession(sessionId, {
    store: redisConsoleVaultStore,
    lock: redisConsoleVaultLock,
    upstreamRefresh,
  })
  return isConsoleVaultEntry(entry) ? entry : null
})

export async function getConsoleAccessToken(): Promise<string | null> {
  return (await getConsoleSessionEntry())?.accessToken ?? null
}

export async function getCurrentConsoleSession(): Promise<{
  sessionId: string
  entry: ConsoleVaultEntry
} | null> {
  const sessionId = (await cookies()).get(CONSOLE_SESSION_COOKIE_NAME)?.value
  if (!sessionId) return null

  const entry = await redisConsoleVaultStore.get(sessionId)
  return entry && isConsoleVaultEntry(entry) ? { sessionId, entry } : null
}
