import {
  isInvalidRefreshError,
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionRefreshUnsafeError,
} from './errors'
import { startLockRenewal } from './lock-renewal'
import { redisVaultLock } from './session-lock'
import type {
  UpstreamRefreshFn,
  UpstreamRefreshResult,
  VaultEntry,
  VaultLock,
  VaultStore,
} from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

import 'server-only'

/** Refresh proactively before the access token actually expires. */
const REFRESH_SAFETY_MARGIN_MS = 30 * 1000
const LOCK_TTL_MS = 10 * 1000
// Renew well before the lease could expire, so a merely slow (but healthy)
// upstream call never loses exclusivity to its own TTL.
const LOCK_RENEWAL_INTERVAL_MS = 4 * 1000
// Last-resort circuit breaker for a refresh that never settles at all —
// not the primary bound; renewal is (see round-2 fix in ai/models-talk.md).
const UPSTREAM_REFRESH_CEILING_MS = 30 * 1000

export interface EnsureFreshSessionDeps {
  store: VaultStore
  lock: VaultLock
  upstreamRefresh: UpstreamRefreshFn
  now?: () => number
}

function isFresh(entry: VaultEntry, now: number): boolean {
  return entry.accessTokenExpiresAt > now + REFRESH_SAFETY_MARGIN_MS
}

/**
 * Returns a `VaultEntry` with a currently-valid access token for
 * `sessionId`, refreshing it via the correctness-critical single-flight
 * protocol from ADR-068 if needed. Throws `SessionNotFoundError` if there is
 * no session, `SessionLockTimeoutError` on lock contention,
 * `SessionRefreshUnsafeError` (vault deleted) if lock exclusivity could not
 * be proven for the whole refresh, or rethrows whatever `upstreamRefresh`
 * threw — deleting the vault only when it was an explicit invalid/reuse
 * rejection, never for a transient failure. Any Redis-store failure
 * propagates as `SessionVaultUnavailableError` — callers must treat that as
 * "cannot authenticate," never fall back to trusting a cached value.
 */
export async function ensureFreshSession(
  sessionId: string,
  deps: EnsureFreshSessionDeps = {
    store: redisVaultStore,
    lock: redisVaultLock,
    upstreamRefresh: notConfiguredUpstreamRefresh,
  }
): Promise<VaultEntry> {
  const now = deps.now ?? Date.now
  const entry = await deps.store.get(sessionId)
  if (!entry) throw new SessionNotFoundError(sessionId)
  if (isFresh(entry, now())) return entry

  return refreshUnderLock(sessionId, deps, now)
}

async function refreshUnderLock(
  sessionId: string,
  deps: EnsureFreshSessionDeps,
  now: () => number
): Promise<VaultEntry> {
  const token = await deps.lock.acquire(sessionId, LOCK_TTL_MS)
  if (!token) throw new SessionLockTimeoutError(sessionId)

  try {
    // Re-read after acquiring the lock: another request may have already
    // refreshed while this one waited. Skipping this check is exactly the
    // "lock only around refresh, no vault" design ADR-068 rejected.
    const reRead = await deps.store.get(sessionId)
    if (!reRead) throw new SessionNotFoundError(sessionId)
    if (isFresh(reRead, now())) return reRead

    return await performRefresh(sessionId, reRead, token, deps)
  } finally {
    await deps.lock.release(sessionId, token)
  }
}

async function performRefresh(
  sessionId: string,
  current: VaultEntry,
  lockToken: string,
  deps: EnsureFreshSessionDeps
): Promise<VaultEntry> {
  const controller = new AbortController()
  const renewal = startLockRenewal(sessionId, lockToken, deps.lock, controller, {
    ttlMs: LOCK_TTL_MS,
    intervalMs: LOCK_RENEWAL_INTERVAL_MS,
    ceilingMs: UPSTREAM_REFRESH_CEILING_MS,
  })

  let upstream: UpstreamRefreshResult
  try {
    // Race against `renewal.unsafe` so this always moves on once
    // exclusivity can no longer be proven — whether or not the
    // `upstreamRefresh` implementation itself respects the abort signal.
    upstream = await Promise.race([
      deps.upstreamRefresh(current.refreshToken, controller.signal),
      renewal.unsafe,
    ])
  } catch (error) {
    renewal.stop()
    // Only delete on an explicit backend rejection (401 / reuse-detected /
    // invalid) or a lost-exclusivity failure — never on an ordinary
    // transient failure (network/5xx), which would otherwise log the user
    // out during a routine API blip.
    if (isInvalidRefreshError(error) || error instanceof SessionRefreshUnsafeError) {
      await deps.store.delete(sessionId)
    }
    throw error
  }

  renewal.stop()

  const next = { ...current, ...upstream }
  const written = await deps.store.setIfVersionMatches(sessionId, current.version, next)
  if (written) return { ...next, version: current.version + 1 }

  // Lost an optimistic-concurrency race despite the lock (defense in
  // depth — the lock is not a correctness fence). Trust whatever won.
  const latest = await deps.store.get(sessionId)
  if (!latest) throw new SessionNotFoundError(sessionId)
  return latest
}

function notConfiguredUpstreamRefresh(): never {
  throw new Error('ensureFreshSession called without an upstreamRefresh implementation')
}
