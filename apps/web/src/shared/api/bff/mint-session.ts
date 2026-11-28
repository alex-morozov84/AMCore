import { randomBytes } from 'node:crypto'

import type { UserResponse } from '@amcore/shared'

import { readAccessTokenExpiry } from './issued-access-token'
import type { VaultStore } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

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
  const accessTokenExpiresAt = readAccessTokenExpiry(params.accessToken)
  if (accessTokenExpiresAt === null) throw new TypeError('API access token has no usable expiry')
  const sessionId = randomBytes(32).toString('base64url')

  await store.create(sessionId, {
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    accessTokenExpiresAt,
    userSnapshot: params.user,
  })

  return { sessionId, user: params.user }
}
