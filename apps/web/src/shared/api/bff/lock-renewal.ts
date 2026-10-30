import { SessionRefreshUnsafeError } from './errors'
import type { VaultLock } from './session-vault.types'

export interface LockRenewalOptions {
  ttlMs: number
  intervalMs: number
  /** Ends ORDINARY work that never settles; a healthy lease keeps being renewed for cleanup. */
  ceilingMs: number
  /** Monotonic clock; injectable for tests. */
  now?: () => number
}

export interface LockRenewalHandle {
  /** Stops the timers for good. Results arriving later neither fail nor abort anything. */
  stop(): void
  /**
   * True once ordinary pre-commit work must end: the lease was refused or lost, or the ceiling was
   * reached. Checked before every new step so nothing starts after it.
   */
  readonly ended: boolean
  /**
   * Rejects with `SessionRefreshUnsafeError` when ordinary work must end; never resolves on its
   * own. Race it against EVERY step before the commit point so the owner always moves on, whether
   * or not that step respects `AbortSignal`.
   */
  unsafe: Promise<never>
}

/**
 * Periodically renews `token` for `sessionId` from lock acquisition until the owner calls `stop()`
 * after its cleanup, so a merely slow (but healthy) refresh never loses exclusivity to its own
 * lease expiring (ADR-068 round 2). Ticks never overlap: a tick is skipped while the previous
 * renewal is unresolved, and a renewal unresolved for one whole interval counts as a failed one.
 *
 * Two different endings are kept apart:
 * - LEASE LOSS (a refused or failed renewal, or one unresolved for a whole interval): exclusivity
 *   can no longer be proven, ordinary work ends and renewal stops, because a lost lease cannot be
 *   promised renewed.
 * - CEILING: ordinary work ends and the work is aborted, but a still-owned lease keeps being
 *   renewed so a bounded terminal delete runs under it; only `stop()` ends renewal then.
 *
 * After `stop()` the handle is inert: a late renew result is ignored.
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

  let workEnded = false
  let stopped = false
  let leaseLost = false
  let inFlightSince: number | null = null

  const endWork = (): void => {
    if (workEnded) return
    workEnded = true
    controller.abort()
    rejectUnsafe(new SessionRefreshUnsafeError(sessionId))
  }
  const stopTimers = (): void => {
    clearTimeout(ceiling)
    clearInterval(interval)
  }
  const loseLease = (): void => {
    if (stopped || leaseLost) return
    leaseLost = true
    stopTimers()
    endWork()
  }

  const ceiling = setTimeout(() => {
    if (!stopped) endWork()
  }, options.ceilingMs)
  const interval = setInterval(() => {
    if (stopped || leaseLost) return
    if (inFlightSince !== null) {
      if (now() - inFlightSince >= options.intervalMs) loseLease()
      return
    }
    inFlightSince = now()
    // Two-argument `.then` so a rejected renew (an outage, not just a clean "no") also fails closed.
    void lock.renew(sessionId, token, options.ttlMs, { deadlineMs: options.intervalMs }).then(
      (renewed) => {
        inFlightSince = null
        if (!stopped && !renewed) loseLease()
      },
      () => {
        inFlightSince = null
        loseLease()
      }
    )
  }, options.intervalMs)

  return {
    stop() {
      stopped = true
      stopTimers()
    },
    get ended() {
      return workEnded
    },
    unsafe,
  }
}
