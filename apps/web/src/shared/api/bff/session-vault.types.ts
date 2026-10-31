import type { UserResponse } from '@amcore/shared'

import type { BrowserVaultBinding } from './browser-binding.server'

/**
 * A Next-held record of a browser session's real backend credentials.
 * The browser only ever holds the opaque session id (as the `amcore_session`
 * cookie) that keys this entry — see ADR-068.
 */
export interface VaultRecord {
  /** Old persisted records are readable for rejection only; they acquire no inferred browser authority. */
  audience?: 'product' | 'staff' | 'console'
  browser?: BrowserVaultBinding
  refreshToken: string
  accessToken: string
  /** Epoch milliseconds. */
  accessTokenExpiresAt: number
  userSnapshot: UserResponse
}

export interface VaultEntry extends VaultRecord {
  /** Optimistic-concurrency counter, incremented on every successful write. */
  version: number
}

export type NewVaultEntry<TRecord extends VaultRecord = VaultRecord> = TRecord

/**
 * Per-call bound. A caller passes what is left of its own budget; an implementation never waits
 * longer than this for one Redis command. Omitted means the implementation default.
 */
export interface VaultCallOptions {
  deadlineMs?: number
}

/** Redis-backed (or fake, in tests) storage for `VaultEntry` records. */
export interface VaultStore<TRecord extends VaultRecord = VaultRecord> {
  get(
    sessionId: string,
    options?: VaultCallOptions
  ): Promise<(TRecord & Pick<VaultEntry, 'version'>) | null>
  /** Initial write on login/register/OAuth exchange. Starts `version` at 1. */
  create(
    sessionId: string,
    entry: NewVaultEntry<TRecord>,
    options?: VaultCallOptions
  ): Promise<void>
  /**
   * Conditional write: succeeds only if the stored entry's `version` still
   * equals `expectedVersion`. Returns whether the write happened.
   */
  setIfVersionMatches(
    sessionId: string,
    expectedVersion: number,
    entry: NewVaultEntry<TRecord>,
    options?: VaultCallOptions
  ): Promise<boolean>
  delete(sessionId: string, options?: VaultCallOptions): Promise<void>
}

/** Best-effort mutual exclusion, keyed by Next session id. Not a correctness
 * fence on its own — `VaultStore.setIfVersionMatches` is the real guard. */
export interface VaultLock {
  /** Bounded: gives up with `null` once `deadlineMs` has passed; never waits for a late answer. */
  acquire(sessionId: string, ttlMs: number, options?: VaultCallOptions): Promise<string | null>
  renew(
    sessionId: string,
    token: string,
    ttlMs: number,
    options?: VaultCallOptions
  ): Promise<boolean>
  /** Cleanup: never throws; a lost release only leaves the lease to expire. */
  release(sessionId: string, token: string, options?: VaultCallOptions): Promise<void>
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
  signal: AbortSignal,
  browser?: BrowserVaultBinding
) => Promise<UpstreamRefreshResult>
