import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

import type { BackgroundEffectEvidence } from '../../generated/prisma/client.js'

import type { ControlTransaction } from './control-transaction.js'
import { WorkPolicyError } from './work-policy-error.js'

/** A new live broker owner revokes refencing; expire the old bounded cached fence too. */
export async function recoverConservativeAttempt(
  ctx: ControlTransaction,
  row: BackgroundEffectEvidence,
  proveNewOwner: () => Promise<boolean>
): Promise<void> {
  if (
    row.recipeVersion !== 2 ||
    row.policyVersion !== 2 ||
    !row.activeAttemptId ||
    row.outcomeRecorded ||
    !(await proveNewOwner())
  )
    throw new WorkPolicyError('OUTCOME_UNRECORDED')
  const wall = Date.now()
  const monotonic = performance.now()
  await delay(1001)
  const elapsed = performance.now() - monotonic
  if (elapsed < 1001 || Math.abs(Date.now() - wall - elapsed) > 200 || !(await proveNewOwner()))
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
