import 'client-only'

const KEY = 'amcore.deployment-recovery'
const WINDOW_MS = 5 * 60_000
interface Recovery {
  attempts: number[]
  pending?: string
}

function readRecovery(): Recovery {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Recovery
    return {
      attempts: Array.isArray(value.attempts)
        ? value.attempts.filter((at) => typeof at === 'number' && Date.now() - at < WINDOW_MS)
        : [],
      pending: typeof value.pending === 'string' ? value.pending : undefined,
    }
  } catch {
    return { attempts: [] }
  }
}

export function reconcileRecovery(version: string) {
  try {
    const recovery = readRecovery()
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined
    if (recovery.pending === version || navigation?.type === 'reload') {
      delete recovery.pending
      sessionStorage.setItem(KEY, JSON.stringify(recovery))
    }
  } catch {
    /* Storage restrictions leave manual refresh available. */
  }
}

export function allowReplacement(target: string): boolean {
  try {
    const recovery = readRecovery()
    // A reload that did not reach its target must not repeat against cached
    // HTML. A short rolling cap also bounds oscillation between live replicas.
    if (recovery.pending || recovery.attempts.length >= 3) return false
    recovery.pending = target
    recovery.attempts.push(Date.now())
    sessionStorage.setItem(KEY, JSON.stringify(recovery))
    return true
  } catch {
    return false
  }
}
