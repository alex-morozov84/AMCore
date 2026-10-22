import type { AdminQueuesResponse } from '@amcore/shared'

/**
 * An HTTP 200 where every enabled queue is `unavailable` is a degraded observation, not a
 * success: TanStack Query counts it as a success, so the streak is owned here. A mixture
 * of available/unavailable rows, disabled-only inventories and empty inventories are healthy.
 * The admission, backoff and access-loss rules are shared: `@/shared/lib/console-poll-policy`.
 */
export function isDegraded(response: AdminQueuesResponse): boolean {
  const enabled = response.queues.filter((queue) => queue.status !== 'disabled')
  return enabled.length > 0 && enabled.every((queue) => queue.status === 'unavailable')
}
