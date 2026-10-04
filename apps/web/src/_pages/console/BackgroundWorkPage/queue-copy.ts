import type { AdminQueue, AdminQueueCounts } from '@amcore/shared'

/** What "Waiting" shows: BullMQ keeps priority jobs in a separate set. */
export function queuedCount(counts: AdminQueueCounts): number {
  return counts.waiting + counts.prioritized
}

/**
 * Derived, never stored: nothing is queued, running, scheduled or waiting on children.
 * Retained failures do not make a queue busy.
 */
export function isEmpty(counts: AdminQueueCounts): boolean {
  return queuedCount(counts) + counts.active + counts.delayed + counts.waitingChildren === 0
}

export type AgeUnit = 'ageSeconds' | 'ageMinutes' | 'ageHours' | 'ageDays'

/** Largest whole unit; the age is already a lower bound, so rounding down is honest. */
export function ageParts(seconds: number): { unit: AgeUnit; n: number } {
  if (seconds < 60) return { unit: 'ageSeconds', n: seconds }
  if (seconds < 3600) return { unit: 'ageMinutes', n: Math.floor(seconds / 60) }
  if (seconds < 86_400) return { unit: 'ageHours', n: Math.floor(seconds / 3600) }
  return { unit: 'ageDays', n: Math.floor(seconds / 86_400) }
}

export type QueueRow = AdminQueue

/** Every enabled queue is unavailable: the screen adds one notice on top of the per-row states. */
export function allUnavailable(queues: readonly AdminQueue[]): boolean {
  const enabled = queues.filter((queue) => queue.status !== 'disabled')
  return enabled.length > 0 && enabled.every((queue) => queue.status === 'unavailable')
}
