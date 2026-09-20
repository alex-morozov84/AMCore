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

/**
 * A pluggable token source for a caller with its own, isolated session
 * (e.g. the Operations Console's host/path-aware session — ADR-081), so
 * this shared transport never has to know a second session domain exists.
 * Defaults to `getBackendAccessToken` (the product session) below —
 * every existing call site is unaffected.
 */
export type TokenResolver = () => Promise<string | null>

function isAuthInfrastructureFailure(error: unknown): boolean {
  if (error instanceof SessionVaultUnavailableError || error instanceof SessionLockTimeoutError) {
    return true
  }

  const code = (error as { code?: unknown } | null)?.code
  return code === 'network' || code === 'timeout'
}

export async function resolveAuthHeader(
  mode: BackendAuthMode,
  tokenResolver: TokenResolver = getBackendAccessToken
): Promise<AuthHeaderResult> {
  if (mode === 'none') return {}

  let token: string | null
  try {
    token = await tokenResolver()
  } catch (error) {
    if (!isAuthInfrastructureFailure(error)) throw error
    return { unavailable: true }
  }
  if (token) return { header: `Bearer ${token}` }
  if (mode === 'required') throw new BackendAuthRequiredError()
  return {}
}
