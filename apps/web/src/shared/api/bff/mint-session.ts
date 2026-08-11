import { randomBytes } from 'node:crypto'

import type { UserResponse } from '@amcore/shared'

import type { VaultStore } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'
import { ACCESS_TOKEN_LIFETIME_MS } from './vault-constants'

import 'server-only'

export interface MintSessionParams {
  accessToken: string
  refreshToken: string
  user: UserResponse
}

export interface MintedSession {
  sessionId: string
  user: UserResponse
}

/**
 * Creates a new vault entry for a just-authenticated user (login/register/
 * OAuth exchange) and returns the opaque session id to cookie on the
 * browser. `store` defaults to the real Redis-backed one; injectable for
 * tests.
 */
export async function mintSession(
  params: MintSessionParams,
  store: VaultStore = redisVaultStore
): Promise<MintedSession> {
  const sessionId = randomBytes(32).toString('base64url')

  await store.create(sessionId, {
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_MS,
    userSnapshot: params.user,
  })

  return { sessionId, user: params.user }
}
