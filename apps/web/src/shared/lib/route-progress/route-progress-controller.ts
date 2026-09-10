/**
 * Framework-agnostic state machine behind the top route-progress bar
 * (`@/shared/ui/route-progress-bar`). Deliberately has no React/Next
 * dependency so its timing logic is testable with fake timers alone -- see
 * `route-progress-controller.test.ts`.
 *
 * Phases: `idle` -> `delaying` (waiting out the reveal delay so a
 * fast/prefetched navigation never flashes the bar) -> `visible` (crawling)
 * -> `completing` (quick finish-to-full fade) -> back to `idle`. A `finish()`
 * that arrives during `delaying` skips straight back to `idle` with nothing
 * ever rendered. A navigation that never calls `finish()` (aborted, failed,
 * or simply never commits) is force-completed by `maxDurationMs` so the bar
 * can never get stuck. Repeated `start()` calls while already
 * delaying/visible/completing are coalesced into the same logical
 * navigation, never re-triggering the reveal delay from scratch.
 */

export type RouteProgressPhase = 'idle' | 'delaying' | 'visible' | 'completing'

export interface RouteProgressControllerOptions {
  /** How long a navigation must still be pending before the bar renders at all. */
  revealDelayMs?: number
  /** Force-finishes a navigation that never calls finish() (aborted/failed/stuck). */
  maxDurationMs?: number
  /** How long the finish-to-full fade stays visible before unmounting. */
  completingMs?: number
}

const DEFAULT_REVEAL_DELAY_MS = 120
const DEFAULT_MAX_DURATION_MS = 6000
const DEFAULT_COMPLETING_MS = 200

export interface RouteProgressController {
  getPhase(): RouteProgressPhase
  subscribe(listener: () => void): () => void
  start(): void
  finish(): void
  /** Clears all pending timers without notifying subscribers -- for unmount/pagehide cleanup. */
  dispose(): void
}

export function createRouteProgressController(
  options: RouteProgressControllerOptions = {}
): RouteProgressController {
  const revealDelayMs = options.revealDelayMs ?? DEFAULT_REVEAL_DELAY_MS
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const completingMs = options.completingMs ?? DEFAULT_COMPLETING_MS

  let phase: RouteProgressPhase = 'idle'
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let maxDurationTimer: ReturnType<typeof setTimeout> | undefined
  let completingTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  function clearTimers() {
    clearTimeout(revealTimer)
    clearTimeout(maxDurationTimer)
    clearTimeout(completingTimer)
    revealTimer = undefined
    maxDurationTimer = undefined
    completingTimer = undefined
  }

  function setPhase(next: RouteProgressPhase) {
    phase = next
    notify()
  }

  function beginCompleting() {
    clearTimeout(maxDurationTimer)
    maxDurationTimer = undefined
    setPhase('completing')
    completingTimer = setTimeout(() => {
      completingTimer = undefined
      setPhase('idle')
    }, completingMs)
  }

  return {
    getPhase: () => phase,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start() {
      if (phase === 'delaying' || phase === 'visible') return // coalesce
      if (phase === 'completing') {
        // A new navigation started while the previous one was fading out --
        // it was already on screen, so skip the reveal delay instead of
        // flashing it away and immediately back.
        clearTimeout(completingTimer)
        completingTimer = undefined
        setPhase('visible')
        maxDurationTimer = setTimeout(() => beginCompleting(), maxDurationMs)
        return
      }
      // idle
      setPhase('delaying')
      revealTimer = setTimeout(() => {
        revealTimer = undefined
        setPhase('visible')
        maxDurationTimer = setTimeout(() => beginCompleting(), maxDurationMs)
      }, revealDelayMs)
    },

    finish() {
      if (phase === 'idle' || phase === 'completing') return
      if (phase === 'delaying') {
        clearTimeout(revealTimer)
        revealTimer = undefined
        setPhase('idle')
        return
      }
      // visible
      beginCompleting()
    },

    dispose() {
      clearTimers()
      phase = 'idle'
    },
  }
}

/** The one instance the real app mounts and every call site imports. */
export const routeProgressController = createRouteProgressController()
