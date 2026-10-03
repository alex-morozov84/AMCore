'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { type AdminQueuesResponse, adminQueuesResponseSchema } from '@amcore/shared'
import { focusManager, onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import {
  canRefreshManually,
  floorsAfterFailure,
  isAccessLoss,
  isAdmitted,
  isDegraded,
  NO_FLOORS,
  POLL_INTERVAL_MS,
  type PollFloors,
  retryAfterSecondsOf,
} from './queue-poll-policy'

const visibleStore = {
  subscribe: (onChange: () => void) => focusManager.subscribe(onChange),
  get: () => focusManager.isFocused(),
}
const onlineStore = {
  subscribe: (onChange: () => void) => onlineManager.subscribe(onChange),
  get: () => onlineManager.isOnline(),
}

/**
 * Live Background work summary: one TanStack Query observer for the whole screen, driven by a
 * single admission rule (see `queue-poll-policy.ts`). Automatic fetches run only while auto is
 * on, the tab is visible and online, access is intact and every cool-down has elapsed; losing
 * admission cancels queued or in-flight automatic work. A manual refresh joins existing work,
 * honours `Retry-After` and is never queued while offline. 401/403 hide the rows at once,
 * evict the cache and ask the Console frame to re-admit once.
 */
export function useQueueSummary(initial: AdminQueuesResponse, initialUpdatedAt: number) {
  const instance = useId()
  const queryKey = ['console', 'background-work', 'queues', instance]
  const queryClient = useQueryClient()
  const router = useRouteProgressRouter()
  const [auto, setAuto] = useState(true)
  const [denied, setDenied] = useState(false)
  const [floors, setFloors] = useState<PollFloors>(NO_FLOORS)
  const [streak, setStreak] = useState(0)
  const [now, setNow] = useState(initialUpdatedAt)
  const visible = useSyncExternalStore(visibleStore.subscribe, visibleStore.get, () => true)
  const online = useSyncExternalStore(onlineStore.subscribe, onlineStore.get, () => true)
  const manualInFlight = useRef(false)
  const handled = useRef({ data: initialUpdatedAt, error: 0 })

  const admitted = isAdmitted({ auto, denied, visible, online, now, floors })

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      adminQueuesResponseSchema.parse(await consoleApi.getBackgroundWorkQueues(signal)),
    initialData: initial,
    initialDataUpdatedAt: initialUpdatedAt,
    staleTime: 10_000,
    gcTime: 0,
    retry: false,
    enabled: admitted,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  // Re-evaluate admission when the longest cool-down elapses (a one-shot timer, not a poll loop).
  useEffect(() => {
    const until = Math.max(floors.retryAfterUntil, floors.backoffUntil)
    const wait = until - Date.now()
    if (wait <= 0) return undefined
    const timer = setTimeout(() => setNow(Date.now()), wait + 1)
    return () => clearTimeout(timer)
  }, [floors])

  // Losing admission suppresses queued/in-flight AUTOMATIC work, including a request that
  // TanStack left paused while offline. A manual fetch survives, except after access loss.
  useEffect(() => {
    if (admitted || (manualInFlight.current && !denied)) return
    void queryClient.cancelQueries({ queryKey, exact: true }, { revert: true })
  }, [admitted, denied, queryClient])

  // Success: own the degraded streak (a 200 with every queue unavailable is not a success).
  useEffect(() => {
    if (!query.dataUpdatedAt || query.dataUpdatedAt === handled.current.data) return
    handled.current.data = query.dataUpdatedAt
    const at = Date.now()
    setNow(at)
    if (query.data && isDegraded(query.data)) {
      const next = streak + 1
      setStreak(next)
      setFloors(floorsAfterFailure(at, next))
    } else {
      setStreak(0)
      setFloors(NO_FLOORS)
    }
  }, [query.dataUpdatedAt])

  // Failure: access loss ends the display; anything else backs off and honours Retry-After.
  useEffect(() => {
    if (!query.errorUpdatedAt || query.errorUpdatedAt === handled.current.error) return
    handled.current.error = query.errorUpdatedAt
    if (isAccessLoss(query.error)) {
      setDenied(true)
      queryClient.removeQueries({ queryKey, exact: true })
      router.refresh()
      return
    }
    const at = Date.now()
    const next = streak + 1
    setStreak(next)
    setNow(at)
    setFloors(floorsAfterFailure(at, next, retryAfterSecondsOf(query.error)))
  }, [query.errorUpdatedAt])

  const manualAllowed = canRefreshManually({ denied, online, now, floors })
  const refresh = useCallback(async () => {
    if (!canRefreshManually({ denied, online: onlineManager.isOnline(), now: Date.now(), floors }))
      return
    manualInFlight.current = true
    try {
      await query.refetch({ cancelRefetch: false })
    } finally {
      manualInFlight.current = false
    }
  }, [denied, floors, query])

  return {
    data: denied ? null : query.data,
    denied,
    auto,
    setAuto,
    online,
    isFetching: query.isFetching,
    /** The latest refresh failed: rows (if any) are older than the status line says. */
    refreshFailed: query.isError,
    canRefresh: manualAllowed,
    retryAfterSeconds: Math.max(0, Math.ceil((floors.retryAfterUntil - now) / 1000)),
    refresh,
  }
}
