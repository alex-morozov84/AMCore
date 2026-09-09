import { SessionLockTimeoutError, SessionVaultUnavailableError } from '../bff/errors'

import { getBackendAccessToken } from './access-token'
import { BackendAuthRequiredError } from './errors'

import 'server-only'

/**
 * `'none'` never touches the session vault - safe for a public read even
 * when Redis/session-refresh is unavailable, since a public read has no
 * reason to depend on auth infrastructure at all. `'optional'` attaches a
 * token when a session exists and proceeds anonymously when it genuinely
 * does not (a real "logged out" result, not an error); a vault failure
 * (auth could not be *proven* either way) is **not** silently treated as
 * anonymous - the caller sees `{ unavailable: true }` and must treat it
 * like any other backend failure. `'required'` does the same vault-failure
 * handling, but throws `BackendAuthRequiredError` (a caller-contract error,
 * not an availability one) when the session genuinely does not exist.
 */
export type BackendAuthMode = 'none' | 'optional' | 'required'

export type AuthHeaderResult = { header?: string } | { unavailable: true }

function isAuthInfrastructureFailure(error: unknown): boolean {
  if (error instanceof SessionVaultUnavailableError || error instanceof SessionLockTimeoutError) {
    return true
  }

  const code = (error as { code?: unknown } | null)?.code
  return code === 'network' || code === 'timeout'
}

export async function resolveAuthHeader(mode: BackendAuthMode): Promise<AuthHeaderResult> {
  if (mode === 'none') return {}

  let token: string | null
  try {
    token = await getBackendAccessToken()
  } catch (error) {
    if (!isAuthInfrastructureFailure(error)) throw error
    return { unavailable: true }
  }
  if (token) return { header: `Bearer ${token}` }
  if (mode === 'required') throw new BackendAuthRequiredError()
  return {}
}
