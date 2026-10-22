import { partial, type ScheduledJobResult, skippedFor, succeeded } from './scheduled-job.js'

/**
 * What one recovery pass of a durable dispatcher did. `completed` means the dispatcher was ready
 * and the pass ran to the end of its work (reap, then drain); it says nothing about whether any
 * delivery or AI run succeeded, which stays with the Background work diagnostics.
 */
export interface DispatchCycleResult {
  status: 'not_ready' | 'shutdown' | 'busy' | 'completed'
  /** Lanes that caught an exception while processing a claim during this pass. */
  isolatedFailures: number
}

/** Shared by the dispatch services that count caught lane failures in one budget object. */
export interface DrainBudget {
  remaining: number
  errors: number
}

export const CYCLE_NOT_READY: DispatchCycleResult = { status: 'not_ready', isolatedFailures: 0 }
export const CYCLE_SHUTDOWN: DispatchCycleResult = { status: 'shutdown', isolatedFailures: 0 }
export const CYCLE_BUSY: DispatchCycleResult = { status: 'busy', isolatedFailures: 0 }

export function cycleOutcome(result: DispatchCycleResult): ScheduledJobResult {
  switch (result.status) {
    case 'not_ready':
      return skippedFor('not_ready')
    case 'shutdown':
      return skippedFor('shutdown')
    // The reap ran but every lane was taken: not a completed pass, so it does not refresh freshness.
    case 'busy':
      return skippedFor('busy')
    case 'completed':
      return result.isolatedFailures === 0
        ? succeeded()
        : partial('isolated_failure', {
            counts: { isolatedFailures: result.isolatedFailures },
            codes: [],
          })
  }
}
