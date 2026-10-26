import type { BackgroundEffectEvidence } from '../../generated/prisma/client.js'

import type { RetryAfterConstraint } from './provider-window-clock.js'
import { WorkPolicyError } from './work-policy-error.js'

export function isConservativeEvidence(row: BackgroundEffectEvidence): boolean {
  return row.policyVersion === 2 && row.recipeVersion === 2
}

/** Retained records never acquire v2 privileges by a policy label alone. */
export function assertConservativeAdmission(row: BackgroundEffectEvidence): void {
  if (!isConservativeEvidence(row)) throw new WorkPolicyError('VERSION_UNSUPPORTED')
  if (!row.outcomeRecorded || row.activeAttemptId) throw new WorkPolicyError('OUTCOME_UNRECORDED')
  if (row.certainty === 'accepted') throw new WorkPolicyError('EFFECT_ACCEPTED')
  if (row.certainty === 'unknown' || row.unresolvedCount !== 0)
    throw new WorkPolicyError('EFFECT_UNKNOWN')
  if (row.cooldownSupported === false) throw new WorkPolicyError('CONTENT_UNSUPPORTED')
}

export function conservativeDelay(
  starts: number,
  constraint?: RetryAfterConstraint
): { delay: number; supported: boolean } {
  const backoff = 1000 * 2 ** Math.max(0, starts - 1)
  if (!Number.isInteger(starts) || starts < 1 || starts > 11)
    throw new WorkPolicyError('CONTENT_UNSUPPORTED')
  if (!constraint) return { delay: backoff, supported: true }
  if (
    constraint.kind !== 'duration' ||
    !Number.isSafeInteger(constraint.milliseconds) ||
    constraint.milliseconds < 0 ||
    constraint.milliseconds > 86_400_000
  )
    return { delay: backoff, supported: false }
  return { delay: Math.max(backoff, constraint.milliseconds), supported: true }
}
