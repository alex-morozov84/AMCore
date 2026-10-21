'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { type ScheduledJobsResponse, scheduledJobsResponseSchema } from '@amcore/shared'
import { focusManager, onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { useCooldownTicks } from '@/shared/lib/console-cooldown-ticks'
import {
  canRefreshManually,
  floorsAfterFailure,
  isAccessLoss,
  isAdmitted,
  NO_FLOORS,
  POLL_INTERVAL_MS,
  type PollFloors,
  retryAfterSecondsOf,
} from '@/shared/lib/console-poll-policy'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

const visibleStore = {
  subscribe: (onChange: () => void) => focusManager.subscribe(onChange),
  get: () => focusManager.isFocused(),
}
const onlineStore = {
  subscribe: (onChange: () => void) => onlineManager.subscribe(onChange),
  get: () => onlineManager.isOnline(),
}

/**
 * Live Scheduled jobs list: one TanStack Query observer driven by the shared admission rule
 * (`@/shared/lib/console-poll-policy`). Automatic fetches run only while auto is on, the tab is
 * visible and online, access is intact and every cool-down has elapsed; losing admission cancels
 * queued or in-flight automatic work. A manual refresh joins existing work, honours `Retry-After`
 * and is never queued while offline. 401/403 hide the rows at once, evict the cache and ask the
 * Console frame to re-admit once. A job that failed or is overdue is a successful read: only a
 * failed HTTP read backs the polling off.
 */
export function useScheduledJobs(initial: ScheduledJobsResponse, initialUpdatedAt: number) {
  const instance = useId()
  const queryKey = ['console', 'scheduled-jobs', 'list', instance]
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
  const accessLost = useRef(false)
  const owns = useCallback(
    (key: readonly unknown[]) =>
      key[0] === 'console' && key[1] === 'scheduled-jobs' && key.includes(instance),
    [instance]
  )

  const admitted = isAdmitted({ auto, denied, visible, online, now, floors })

  const query = useQuery<ScheduledJobsResponse>({
    // After access loss the observer must not rebuild the private cache from the server snapshot.
    queryKey: denied ? [...queryKey, 'denied'] : queryKey,
    queryFn: async ({ signal }) =>
      scheduledJobsResponseSchema.parse(await consoleApi.getScheduledJobs(signal)),
    initialData: denied ? undefined : initial,
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

  useCooldownTicks(floors, setNow)

  /**
   * The one access-loss path, for the list and every history: hide rows and histories at once,
   * cancel what is in flight, drop the private cache and ask the Console frame to re-admit once.
   */
  const reportAccessLoss = useCallback(() => {
    if (accessLost.current) return
    accessLost.current = true
    setDenied(true)
    const predicate = (candidate: { queryKey: readonly unknown[] }): boolean =>
      owns(candidate.queryKey)
    void queryClient.cancelQueries({ predicate })
    queryClient.removeQueries({ predicate })
    router.refresh()
  }, [owns, queryClient, router])

  // Every transition that leaves automatic fetching unadmitted cancels queued or in-flight
  // AUTOMATIC work. A manual fetch survives, except after access loss.
  useEffect(() => {
    if (admitted || (manualInFlight.current && !denied)) return
    void queryClient.cancelQueries({ queryKey, exact: true }, { revert: true })
  }, [admitted, auto, denied, visible, online, queryClient])

  useEffect(() => {
    if (!query.dataUpdatedAt || query.dataUpdatedAt === handled.current.data) return
    handled.current.data = query.dataUpdatedAt
    setNow(Date.now())
    setStreak(0)
    setFloors(NO_FLOORS)
    // Opened histories follow the page: only mounted (opened) ones refetch, closed ones have no observer.
    void queryClient.invalidateQueries({
      queryKey: ['console', 'scheduled-jobs', 'runs', instance],
      refetchType: 'active',
    })
  }, [query.dataUpdatedAt])

  // Failure: access loss ends the display; anything else backs off and honours Retry-After.
  useEffect(() => {
    if (!query.errorUpdatedAt || query.errorUpdatedAt === handled.current.error) return
    handled.current.error = query.errorUpdatedAt
    if (isAccessLoss(query.error)) {
      reportAccessLoss()
      return
    }
    const at = Date.now()
    const next = streak + 1
    setStreak(next)
    setNow(at)
    setFloors(floorsAfterFailure(at, next, retryAfterSecondsOf(query.error)))
  }, [query.errorUpdatedAt])

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
    data: denied ? null : (query.data ?? null),
    instance,
    reportAccessLoss,
    denied,
    auto,
    setAuto,
    online,
    isFetching: query.isFetching,
    /** The latest refresh failed: rows (if any) are older than the status line says. */
    refreshFailed: query.isError,
    canRefresh: canRefreshManually({ denied, online, now, floors }),
    retryAfterSeconds: Math.max(0, Math.ceil((floors.retryAfterUntil - now) / 1000)),
    refresh,
  }
}
