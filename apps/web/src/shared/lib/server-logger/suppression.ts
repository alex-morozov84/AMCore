import 'server-only'

/**
 * Bounded per-process volume limiter: within `windowMs` of a key's first
 * occurrence, every repeat is counted but not logged; once the window
 * elapses, the next occurrence logs again and reports how many were
 * suppressed meanwhile. This is observability state, not correctness state
 * — per-instance memory is acceptable (a multi-replica/serverless
 * deployment suppresses independently per instance, which is a documented
 * limitation, not a bug).
 *
 * `MAX_TRACKED_KEYS` bounds the registry itself: an attacker or a bug that
 * generates unbounded distinct keys must not turn this into its own memory
 * leak. Eviction is oldest-inserted-first, not true LRU — good enough for a
 * cap, not a cache-hit-rate feature.
 */
const MAX_TRACKED_KEYS = 500

interface SuppressionWindow {
  windowStartedAt: number
  suppressedCount: number
}

const registry = new Map<string, SuppressionWindow>()

export interface SuppressionCheck {
  shouldLog: boolean
  /** Only meaningful when `shouldLog` is true. */
  suppressedSinceLastLog: number
}

export function checkSuppression(
  key: string,
  windowMs: number,
  now = Date.now()
): SuppressionCheck {
  const existing = registry.get(key)
  const windowExpired = !existing || now - existing.windowStartedAt >= windowMs

  if (!windowExpired) {
    existing.suppressedCount += 1
    return { shouldLog: false, suppressedSinceLastLog: 0 }
  }

  if (registry.size >= MAX_TRACKED_KEYS && !registry.has(key)) {
    const oldestKey = registry.keys().next().value
    if (oldestKey !== undefined) registry.delete(oldestKey)
  }
  registry.set(key, { windowStartedAt: now, suppressedCount: 0 })
  return { shouldLog: true, suppressedSinceLastLog: existing?.suppressedCount ?? 0 }
}

/** Test-only: reset between cases so one test's keys never leak into the next. */
export function resetSuppressionRegistryForTests(): void {
  registry.clear()
}
