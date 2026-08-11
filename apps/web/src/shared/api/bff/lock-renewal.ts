import { SessionRefreshUnsafeError } from './errors'
import type { VaultLock } from './session-vault.types'

export interface LockRenewalOptions {
  ttlMs: number
  intervalMs: number
  /** Absolute circuit breaker for a refresh that never settles at all. */
  ceilingMs: number
}

export interface LockRenewalHandle {
  stop(): void
  /**
   * Rejects with `SessionRefreshUnsafeError` the moment a renewal is
   * refused or the ceiling is reached — never resolves on its own. Race it
   * against the operation the lock protects so the caller always moves on,
   * whether or not that operation itself respects `AbortSignal`.
   */
  unsafe: Promise<never>
}

/**
 * Periodically renews `token` for `sessionId` while a long-running refresh
 * is in flight, so a merely slow (but healthy) backend call never loses
 * lock exclusivity to its own lease expiring — that was the actual gap in
 * a fixed client-side timeout (ADR-068 round 2): an aborted wait doesn't
 * prove the backend didn't still complete the rotation server-side. If
 * renewal genuinely fails (lost exclusivity) or the ceiling is hit, the
 * caller can no longer prove the vault's refresh token wasn't rotated by an
 * abandoned attempt, and must treat the session as unsafe rather than keep
 * trusting it.
 */
export function startLockRenewal(
  sessionId: string,
  token: string,
  lock: VaultLock,
  controller: AbortController,
  options: LockRenewalOptions
): LockRenewalHandle {
  let rejectUnsafe!: (reason: unknown) => void
  const unsafe = new Promise<never>((_, reject) => {
    rejectUnsafe = reject
  })

  // Idempotent by construction (abort/clear/reject are all no-ops once
  // already fired) — an explicit guard on top anyway, so a reader doesn't
  // have to trust three separate primitives' idempotency to see that a
  // rejected renew racing the ceiling can't double-act.
  let failed = false
  const fail = () => {
    if (failed) return
    failed = true
    controller.abort()
    clearInterval(interval)
    clearTimeout(ceiling)
    rejectUnsafe(new SessionRefreshUnsafeError(sessionId))
  }

  const ceiling = setTimeout(fail, options.ceilingMs)

  const interval = setInterval(() => {
    // Two-argument `.then` so a *rejected* renew (e.g. Redis outage/network
    // error, not just a clean "no" reply) also fails closed — a promise
    // rejection reaching neither handler here would otherwise become an
    // unhandled rejection while the refresh in progress keeps running.
    void lock.renew(sessionId, token, options.ttlMs).then(
      (renewed) => {
        if (!renewed) fail()
      },
      () => fail()
    )
  }, options.intervalMs)

  return {
    stop() {
      clearTimeout(ceiling)
      clearInterval(interval)
    },
    unsafe,
  }
}
