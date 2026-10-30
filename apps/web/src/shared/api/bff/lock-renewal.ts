import { SessionRefreshUnsafeError } from './errors'
import type { VaultLock } from './session-vault.types'

export interface LockRenewalOptions {
  ttlMs: number
  intervalMs: number
  /** Absolute circuit breaker for pre-commit work that never settles at all. */
  ceilingMs: number
  /** Monotonic clock; injectable for tests. */
  now?: () => number
}

export interface LockRenewalHandle {
  /** Stops the timers. Results arriving later neither fail nor abort anything. */
  stop(): void
  /**
   * Rejects with `SessionRefreshUnsafeError` the moment a renewal is refused, fails, stays
   * unresolved for a whole interval, or the ceiling is reached; never resolves on its own. Race it
   * against EVERY step before the commit point so the owner always moves on, whether or not that
   * step respects `AbortSignal`.
   */
  unsafe: Promise<never>
}

/**
 * Periodically renews `token` for `sessionId` from lock acquisition until the owner finishes its
 * cleanup, so a merely slow (but healthy) refresh never loses exclusivity to its own lease
 * expiring (ADR-068 round 2). Ticks never overlap: a tick is skipped while the previous renewal is
 * unresolved, and a renewal unresolved for one whole interval counts as a failed renewal. If
 * renewal genuinely fails (lost exclusivity) or the ceiling is hit, the caller can no longer prove
 * the vault's refresh token was not rotated by an abandoned attempt and must treat the outcome as
 * unproven. After `stop()` the handle is inert: a late renew result is ignored.
 *
 * The ceiling ends normal pre-commit work only. Bounded deletion and release may continue after
 * it; it is not a total resource lifetime.
 */
export function startLockRenewal(
  sessionId: string,
  token: string,
  lock: VaultLock,
  controller: AbortController,
  options: LockRenewalOptions
): LockRenewalHandle {
  const now = options.now ?? (() => performance.now())
  let rejectUnsafe!: (reason: unknown) => void
  const unsafe = new Promise<never>((_, reject) => {
    rejectUnsafe = reject
  })
  // Observed here so a failure that nobody is racing yet is never an unhandled rejection.
  unsafe.catch(() => undefined)

  let finished = false
  let inFlightSince: number | null = null
  const finish = (): void => {
    finished = true
    clearTimeout(ceiling)
    clearInterval(interval)
  }
  const fail = (): void => {
    if (finished) return
    finish()
    controller.abort()
    rejectUnsafe(new SessionRefreshUnsafeError(sessionId))
  }

  const ceiling = setTimeout(fail, options.ceilingMs)
  const interval = setInterval(() => {
    if (finished) return
    if (inFlightSince !== null) {
      if (now() - inFlightSince >= options.intervalMs) fail()
      return
    }
    inFlightSince = now()
    // Two-argument `.then` so a rejected renew (an outage, not just a clean "no") also fails closed.
    void lock.renew(sessionId, token, options.ttlMs, { deadlineMs: options.intervalMs }).then(
      (renewed) => {
        inFlightSince = null
        if (!finished && !renewed) fail()
      },
      () => {
        inFlightSince = null
        fail()
      }
    )
  }, options.intervalMs)

  return {
    stop() {
      finish()
    },
    unsafe,
  }
}
