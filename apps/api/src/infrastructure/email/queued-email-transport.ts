import { performance } from 'node:perf_hooks'

import {
  PROVIDER_WINDOW_CLOCK,
  transportFenceEligible,
} from '../background-work/provider-window-clock'

import type { QueuedEmailOutcome, QueuedEmailProvider } from './queued-email-provider'

export interface LocalClockSample {
  readonly wall: number
  readonly monotonic: number
}
export function sampleLocalClock(): LocalClockSample {
  return { wall: Date.now(), monotonic: performance.now() }
}
export interface QueuedTransportFence {
  readonly redisTime: number
  readonly pgTime: number
  readonly nominalDeadline: number
  readonly floorUpper: number
  /** Taken before EVAL, so the measured elapsed age conservatively includes its round trip. */
  readonly beforeEval: LocalClockSample
  /** Taken before PG reservation/refence, including transaction and commit latency. */
  readonly beforePg: LocalClockSample
}
export type QueuedTransportResult =
  | { readonly status: 'outcome'; readonly outcome: QueuedEmailOutcome }
  | {
      readonly status: 'not-called'
      readonly reason: 'CLOCK_UNCERTAIN' | 'PROVIDER_CHANGED' | 'WORK_UNAVAILABLE'
    }

class TransportRefused extends Error {
  constructor(readonly reason: 'CLOCK_UNCERTAIN' | 'PROVIDER_CHANGED') {
    super(reason)
  }
}

/** Approved recipe only. Each refresh must refence the SAME reservation; no send is retried here. */
export async function sendFrozenQueuedEmail(
  provider: QueuedEmailProvider,
  body: string,
  key: string,
  scope: string,
  initialFence: QueuedTransportFence,
  refresh: () => Promise<QueuedTransportFence>
): Promise<QueuedTransportResult> {
  let fence = initialFence
  for (let pass = 0; pass < 2; pass += 1) {
    let called = false
    try {
      const outcome = await provider.send(
        body,
        key,
        AbortSignal.timeout(PROVIDER_WINDOW_CLOCK.maxTransportLifetimeMs),
        () => {
          if (called) throw new TransportRefused('CLOCK_UNCERTAIN')
          if (provider.scope() !== scope) throw new TransportRefused('PROVIDER_CHANGED')
          const current = sampleLocalClock()
          const monotonicAge = current.monotonic - fence.beforePg.monotonic
          const wallAge = current.wall - fence.beforePg.wall
          const pgAge = Math.ceil(Math.max(monotonicAge, wallAge))
          // The PG timestamp occurred somewhere inside this measured bracket. Both
          // possible skew endpoints must fit; nominal equality alone proves nothing.
          const nominalSkew = fence.redisTime - fence.pgTime
          if (
            monotonicAge < 0 ||
            wallAge < 0 ||
            current.wall < fence.beforeEval.wall ||
            current.monotonic < fence.beforeEval.monotonic ||
            Math.max(Math.abs(nominalSkew), Math.abs(nominalSkew - pgAge)) >
              PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs ||
            Math.abs(monotonicAge - wallAge) > PROVIDER_WINDOW_CLOCK.maxDualClockDisagreementMs ||
            !transportFenceEligible({
              redisTime: fence.redisTime,
              wallTime: current.wall,
              monotonicElapsedMs: current.monotonic - fence.beforeEval.monotonic,
              wallElapsedMs: current.wall - fence.beforeEval.wall,
              pgSampleAgeMs: pgAge,
              nominalDeadline: fence.nominalDeadline,
              floorUpper: fence.floorUpper,
            })
          )
            throw new TransportRefused('CLOCK_UNCERTAIN')
          called = true
        }
      )
      if (!called) return { status: 'not-called', reason: 'CLOCK_UNCERTAIN' }
      return { status: 'outcome', outcome }
    } catch (error) {
      // A timeout/abort/network error after fetch admission never proves provider nonacceptance.
      if (called)
        return {
          status: 'outcome',
          outcome: {
            certainty: 'unknown',
            retryable: true,
            code: 'TRANSIENT_FAILURE',
          },
        }
      if (!(error instanceof TransportRefused))
        return { status: 'not-called', reason: 'WORK_UNAVAILABLE' }
      if (error.reason === 'PROVIDER_CHANGED' || pass === 1)
        return { status: 'not-called', reason: error.reason }
      fence = await refresh()
    }
  }
  throw new Error('INVALID_TRANSPORT_STATE')
}
