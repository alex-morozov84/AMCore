import type { Prisma } from '@/generated/prisma/client'

/**
 * A delivery atomically claimed for one processing attempt: leased (`PROCESSING`),
 * its `attemptCount` already incremented to `attemptNumber`, and an in-flight attempt
 * row inserted. The dispatcher performs provider I/O for this row, then finalizes it
 * via a CAS keyed by `(id, leaseToken)`.
 */
export interface ClaimedDelivery {
  id: string
  notificationId: string
  channel: string
  targetKey: string
  targetRef: string | null
  destinationSnapshot: Prisma.JsonValue | null
  locale: string
  /** The attempt number this claim represents (== post-increment `attemptCount`). */
  attemptNumber: number
  maxAttempts: number
  /** Batch lease token; finalize/reap CAS on `(id, leaseToken)`. */
  leaseToken: string
}

/** Result of finalizing a claimed delivery after provider I/O. */
export type FinalizeResult =
  | { state: 'delivered' }
  | { state: 'retry_scheduled'; nextAttemptAt: Date }
  | { state: 'failed'; reasonCode: string; deadLettered: boolean }
  /** The CAS matched no row — the lease was lost/expired and reclaimed elsewhere. */
  | { state: 'lease_lost' }

/** Aggregate outcome of one reaper pass over expired `PROCESSING` leases. */
export interface ReapResult {
  rescheduled: number
  deadLettered: number
}
