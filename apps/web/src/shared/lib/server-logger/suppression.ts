import 'server-only'

/**
 * Bounded per-process volume limiter with two independent caps:
 *
 * 1. Per-key: within `windowMs` of a key's first occurrence, every repeat of
 *    that same key is counted but not logged.
 * 2. Global: at most `maxLogLinesPerWindow` log lines total, across every
 *    key combined, may go out per window. A stream of many *distinct* keys
 *    (unlike a repeat of one key) is not caught by the per-key cap alone -
 *    this is what actually bounds volume, not just registry memory.
 *
 * Once the global window rolls over, the next successful log line reports
 * how many were dropped by the global cap during the window that just
 * ended, alongside its own per-key suppressed count.
 *
 * This is observability state, not correctness state - per-instance memory
 * is acceptable (a multi-replica/serverless deployment suppresses
 * independently per instance, a documented limitation, not a bug).
 *
 * `MAX_TRACKED_KEYS` separately bounds the per-key registry's own memory: an
 * unbounded stream of distinct keys must not become its own leak even before
 * the global volume cap kicks in. Eviction is oldest-inserted-first, not
 * true LRU - good enough for a cap, not a cache-hit-rate feature.
 */
const MAX_TRACKED_KEYS = 500
const DEFAULT_MAX_LOG_LINES_PER_WINDOW = 200

interface PerKeyWindow {
  windowStartedAt: number
  suppressedCount: number
}

interface GlobalWindow {
  windowStartedAt: number
  linesEmitted: number
  overflowSuppressedCount: number
}

const perKeyRegistry = new Map<string, PerKeyWindow>()
let globalWindow: GlobalWindow = { windowStartedAt: 0, linesEmitted: 0, overflowSuppressedCount: 0 }
/** Carried across a window rollover so the count from the window that just
 *  ended isn't discarded before it can be reported on the next log line. */
let pendingGlobalOverflowReport = 0

export interface SuppressionCheck {
  shouldLog: boolean
  /** Only meaningful when `shouldLog` is true. */
  suppressedSinceLastLog: number
  /** Only meaningful when `shouldLog` is true - lines dropped by the global
   *  volume cap during the window that just ended. */
  globalOverflowSuppressedSinceLastLog: number
}

function rolloverGlobalWindowIfNeeded(now: number, windowMs: number): void {
  if (now - globalWindow.windowStartedAt >= windowMs) {
    pendingGlobalOverflowReport += globalWindow.overflowSuppressedCount
    globalWindow = { windowStartedAt: now, linesEmitted: 0, overflowSuppressedCount: 0 }
  }
}

function evictOldestIfAtCapacity(key: string): void {
  if (perKeyRegistry.size < MAX_TRACKED_KEYS || perKeyRegistry.has(key)) return
  const oldestKey = perKeyRegistry.keys().next().value
  if (oldestKey !== undefined) perKeyRegistry.delete(oldestKey)
}

export function checkSuppression(
  key: string,
  windowMs: number,
  now = Date.now(),
  maxLogLinesPerWindow = DEFAULT_MAX_LOG_LINES_PER_WINDOW
): SuppressionCheck {
  rolloverGlobalWindowIfNeeded(now, windowMs)

  const existing = perKeyRegistry.get(key)
  const keyWindowExpired = !existing || now - existing.windowStartedAt >= windowMs

  if (!keyWindowExpired) {
    existing.suppressedCount += 1
    return { shouldLog: false, suppressedSinceLastLog: 0, globalOverflowSuppressedSinceLastLog: 0 }
  }

  if (globalWindow.linesEmitted >= maxLogLinesPerWindow) {
    globalWindow.overflowSuppressedCount += 1
    return { shouldLog: false, suppressedSinceLastLog: 0, globalOverflowSuppressedSinceLastLog: 0 }
  }

  evictOldestIfAtCapacity(key)
  const suppressedSinceLastLog = existing?.suppressedCount ?? 0
  const globalOverflowSuppressedSinceLastLog = pendingGlobalOverflowReport

  pendingGlobalOverflowReport = 0
  globalWindow.linesEmitted += 1
  perKeyRegistry.set(key, { windowStartedAt: now, suppressedCount: 0 })

  return { shouldLog: true, suppressedSinceLastLog, globalOverflowSuppressedSinceLastLog }
}

/** Test-only: reset between cases so one test's keys never leak into the next. */
export function resetSuppressionRegistryForTests(): void {
  perKeyRegistry.clear()
  globalWindow = { windowStartedAt: 0, linesEmitted: 0, overflowSuppressedCount: 0 }
  pendingGlobalOverflowReport = 0
}
