import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

import type { BackgroundEffectEvidence } from '../../generated/prisma/client.js'

import type { ControlTransaction } from './control-transaction.js'
import { WorkPolicyError } from './work-policy-error.js'

/** Bounded cached fence: recovery waits at least this long on the monotonic clock. */
export const MIN_RECOVERY_WAIT_MS = 1001
/** A wall/monotonic disagreement above this means the wall clock stepped: refuse. */
export const MAX_CLOCK_DRIFT_MS = 200

/** The three clocks the wait depends on; injectable so tests control each one independently. */
export interface RecoveryClock {
  wallNow(): number
  monotonicNow(): number
  delay(ms: number): Promise<void>
}

const systemClock: RecoveryClock = {
  wallNow: () => Date.now(),
  monotonicNow: () => performance.now(),
  delay: (ms) => delay(ms),
}

/**
 * Waits until the monotonic clock has really advanced by `MIN_RECOVERY_WAIT_MS`. A timer can wake
 * a fraction of a millisecond early against `performance.now()` (Node compares whole-millisecond
 * clock readings), so one fixed sleep does not guarantee the bound; wait for the positive
 * remainder and measure again. The deadline stays fixed to the original start.
 */
async function waitForMonotonicBound(clock: RecoveryClock, started: number): Promise<number> {
  let elapsed = 0
  do {
    await clock.delay(Math.max(1, Math.ceil(MIN_RECOVERY_WAIT_MS - elapsed)))
    elapsed = clock.monotonicNow() - started
  } while (elapsed < MIN_RECOVERY_WAIT_MS)
  return elapsed
}

/** A new live broker owner revokes refencing; expire the old bounded cached fence too. */
export async function recoverConservativeAttempt(
  ctx: ControlTransaction,
  row: BackgroundEffectEvidence,
  proveNewOwner: () => Promise<boolean>,
  clock: RecoveryClock = systemClock
): Promise<void> {
  if (
    row.recipeVersion !== 2 ||
    row.policyVersion !== 2 ||
    !row.activeAttemptId ||
    row.outcomeRecorded ||
    !(await proveNewOwner())
  )
    throw new WorkPolicyError('OUTCOME_UNRECORDED')
  const wall = clock.wallNow()
  const monotonic = clock.monotonicNow()
  const elapsed = await waitForMonotonicBound(clock, monotonic)
  if (Math.abs(clock.wallNow() - wall - elapsed) > MAX_CLOCK_DRIFT_MS || !(await proveNewOwner()))
    throw new WorkPolicyError('OUTCOME_UNRECORDED')
  await ctx.tx.backgroundEffectEvidence.update({
    where: { workId_incarnation: { workId: row.workId, incarnation: row.incarnation } },
    data: {
      revision: { increment: 1 },
      activeAttemptId: null,
      outcomeRecorded: true,
      certainty: 'unknown',
      finalizedAt: null,
      safeResult: {
        code: 'TRANSIENT_FAILURE',
        certainty: 'unknown',
        lastAttemptId: row.activeAttemptId,
        retryClockSupported: true,
      },
    },
  })
}
