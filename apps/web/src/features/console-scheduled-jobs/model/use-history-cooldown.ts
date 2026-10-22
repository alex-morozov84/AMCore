'use client'

import { useCallback, useRef, useState } from 'react'

import {
  floorsAfterFailure,
  isAccessLoss,
  NO_FLOORS,
  type PollFloors,
  retryAfterSecondsOf,
} from '@/shared/lib/console-poll-policy'

/**
 * The cool-down of the run histories, shared by every history on the page. `Retry-After` blocks
 * every read, including opening a history again; the exponential backoff blocks only the reads
 * that follow a page refresh on their own. Several histories answer independently, so a deadline
 * only ever moves later: a good answer or a shorter refusal from another history never shortens
 * one that is still running. Access loss is not a cool-down: it goes to the page.
 */
export function useHistoryCooldown(onAccessLoss: () => void) {
  const [floors, setFloors] = useState<PollFloors>(NO_FLOORS)
  const latest = useRef<PollFloors>(NO_FLOORS)
  const streak = useRef(0)

  const reportFailure = useCallback(
    (error: unknown) => {
      if (isAccessLoss(error)) {
        onAccessLoss()
        return
      }
      streak.current += 1
      const next = floorsAfterFailure(Date.now(), streak.current, retryAfterSecondsOf(error))
      const merged = {
        retryAfterUntil: Math.max(latest.current.retryAfterUntil, next.retryAfterUntil),
        backoffUntil: Math.max(latest.current.backoffUntil, next.backoffUntil),
      }
      latest.current = merged
      setFloors(merged)
    },
    [onAccessLoss]
  )

  const reportSuccess = useCallback(() => {
    streak.current = 0
    // A good answer ends the backoff, but never a `Retry-After` another history is still serving.
    const keep = latest.current.retryAfterUntil > Date.now() ? latest.current.retryAfterUntil : 0
    if (latest.current.backoffUntil === 0 && latest.current.retryAfterUntil === keep) return
    const next = { retryAfterUntil: keep, backoffUntil: 0 }
    latest.current = next
    setFloors(next)
  }, [])

  /** May the open histories be read now? A manual page refresh ignores the backoff only. */
  const mayRefetch = useCallback((manual: boolean): boolean => {
    const at = Date.now()
    return !(at < latest.current.retryAfterUntil || (!manual && at < latest.current.backoffUntil))
  }, [])

  return { floors, reportFailure, reportSuccess, mayRefetch }
}
