import type { AdminQueuesResponse } from '@amcore/shared'

import { ApiRequestError } from '@/shared/api/http-client'

/** Base period of the automatic refresh while the tab is visible and online. */
export const POLL_INTERVAL_MS = 30_000
export const MAX_BACKOFF_MS = 300_000
export const MAX_RETRY_AFTER_MS = 300_000

/**
 * An HTTP 200 where every enabled queue is `unavailable` is a degraded observation, not a
 * success: TanStack Query counts it as a success, so the streak is owned here. A mixture
 * of available/unavailable rows, disabled-only inventories and empty inventories are healthy.
 */
export function isDegraded(response: AdminQueuesResponse): boolean {
  const enabled = response.queues.filter((queue) => queue.status !== 'disabled')
  return enabled.length > 0 && enabled.every((queue) => queue.status === 'unavailable')
}

/** 30 s, 60 s, 120 s, 240 s, then 300 s for streaks 1, 2, 3, 4, 5+. */
export function backoffMs(streak: number): number {
  return streak <= 0 ? 0 : Math.min(POLL_INTERVAL_MS * 2 ** (streak - 1), MAX_BACKOFF_MS)
}

export interface PollFloors {
  /** Blocks every trigger, manual included (`Retry-After`). */
  retryAfterUntil: number
  /** Blocks automatic triggers only (exponential backoff). */
  backoffUntil: number
}

export const NO_FLOORS: PollFloors = { retryAfterUntil: 0, backoffUntil: 0 }

export function floorsAfterFailure(
  now: number,
  streak: number,
  retryAfterSeconds?: number
): PollFloors {
  const retryAfter = Math.min((retryAfterSeconds ?? 0) * 1000, MAX_RETRY_AFTER_MS)
  return {
    retryAfterUntil: retryAfter > 0 ? now + retryAfter : 0,
    backoffUntil: now + Math.max(backoffMs(streak), retryAfter),
  }
}

/** 401/403 end the privileged display; anything else is a retryable failure. */
export function isAccessLoss(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403)
}

export function retryAfterSecondsOf(error: unknown): number | undefined {
  return error instanceof ApiRequestError ? error.retryAfterSeconds : undefined
}

/**
 * The single admission rule for AUTOMATIC fetches (interval, focus, reconnect, mount and the
 * `enabled` false→true edge): auto on, not denied, visible, online, and every floor elapsed.
 */
export function isAdmitted(input: {
  auto: boolean
  denied: boolean
  visible: boolean
  online: boolean
  now: number
  floors: PollFloors
}): boolean {
  const { auto, denied, visible, online, now, floors } = input
  return (
    auto &&
    !denied &&
    visible &&
    online &&
    now >= Math.max(floors.retryAfterUntil, floors.backoffUntil)
  )
}

/** Manual refresh ignores backoff and `auto`, but honours `Retry-After`, offline and denial. */
export function canRefreshManually(input: {
  denied: boolean
  online: boolean
  now: number
  floors: PollFloors
}): boolean {
  return !input.denied && input.online && input.now >= input.floors.retryAfterUntil
}
