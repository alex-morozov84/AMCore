import type { UserResponse } from '@amcore/shared'

/**
 * A Next-held record of a browser session's real backend credentials.
 * The browser only ever holds the opaque session id (as the `amcore_session`
 * cookie) that keys this entry — see ADR-068.
 */
export interface VaultEntry {
  refreshToken: string
  accessToken: string
  /** Epoch milliseconds. */
  accessTokenExpiresAt: number
  userSnapshot: UserResponse
  /** Optimistic-concurrency counter, incremented on every successful write. */
  version: number
}

export type NewVaultEntry = Omit<VaultEntry, 'version'>

/** Redis-backed (or fake, in tests) storage for `VaultEntry` records. */
export interface VaultStore {
  get(sessionId: string): Promise<VaultEntry | null>
  /** Initial write on login/register/OAuth exchange. Starts `version` at 1. */
  create(sessionId: string, entry: NewVaultEntry): Promise<void>
  /**
   * Conditional write: succeeds only if the stored entry's `version` still
   * equals `expectedVersion`. Returns whether the write happened.
   */
  setIfVersionMatches(
    sessionId: string,
    expectedVersion: number,
    entry: NewVaultEntry
  ): Promise<boolean>
  delete(sessionId: string): Promise<void>
}

/** Best-effort mutual exclusion, keyed by Next session id. Not a correctness
 * fence on its own — `VaultStore.setIfVersionMatches` is the real guard. */
export interface VaultLock {
  acquire(sessionId: string, ttlMs: number): Promise<string | null>
  renew(sessionId: string, token: string, ttlMs: number): Promise<boolean>
  release(sessionId: string, token: string): Promise<void>
}

export interface UpstreamRefreshResult {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
}

/**
 * `invalid`/`reuse-detected` mean the backend explicitly rejected the
 * refresh token — the vault entry must be deleted (ADR-068). Every other
 * code (including an implementation's own custom ones) is treated as
 * transient: the current request fails, but the session is preserved for
 * the next attempt. See `errors.ts` → `isInvalidRefreshError`.
 */
export type UpstreamRefreshErrorCode = 'invalid' | 'reuse-detected' | 'network' | 'timeout'

export interface UpstreamRefreshError extends Error {
  code: UpstreamRefreshErrorCode
}

/**
 * The signal is aborted if the caller gives up waiting (see
 * `ensure-fresh-session.ts`'s lock-TTL-bounded timeout) — a real HTTP-backed
 * implementation should pass it to `fetch` so the abandoned request doesn't
 * keep running past the point anything will use its result.
 */
export type UpstreamRefreshFn = (
  refreshToken: string,
  signal: AbortSignal
) => Promise<UpstreamRefreshResult>
