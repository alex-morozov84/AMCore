'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  type AdminQueuesResponse,
  adminQueuesResponseSchema,
  workCatalogueSchema,
  type WorkSummary,
} from '@amcore/shared'
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
import { useCooldownTicks } from './use-cooldown-ticks'

type PageSnapshot = AdminQueuesResponse & {
  works?: WorkSummary[]
  queueError?: unknown
  workError?: unknown
  jobsError?: unknown
  workRefreshed?: boolean
}

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
export function useQueueSummary(
  initial: AdminQueuesResponse,
  initialUpdatedAt: number,
  initialWork?: WorkSummary[]
) {
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

  const query = useQuery<PageSnapshot>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!initialWork)
        return {
          ...adminQueuesResponseSchema.parse(await consoleApi.getBackgroundWorkQueues(signal)),
          works: undefined,
          workError: null,
          jobsError: null,
        }
      // Cancel only idle job reads started by this refresh, never a user-initiated filter request.
      const jobReads = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['console', 'background-work', 'jobs'], type: 'active' })
        .filter((item) => item.state.fetchStatus === 'idle')
      const cancelJobs = () => {
        for (const item of jobReads)
          void queryClient.cancelQueries({ queryKey: item.queryKey, exact: true })
      }
      signal.addEventListener('abort', cancelJobs, { once: true })
      let results
      try {
        results = await Promise.allSettled([
          consoleApi
            .getBackgroundWorkQueues(signal)
            .then((value) => adminQueuesResponseSchema.parse(value)),
          consoleApi.getBackgroundWork(signal).then((value) => workCatalogueSchema.parse(value)),
          queryClient.refetchQueries(
            { predicate: (item) => jobReads.includes(item) },
            { cancelRefetch: false, throwOnError: true }
          ),
        ])
      } finally {
        signal.removeEventListener('abort', cancelJobs)
      }
      const [queues, works, jobs] = results
      if (queues.status === 'rejected' && isAccessLoss(queues.reason)) throw queues.reason
      if (works.status === 'rejected' && isAccessLoss(works.reason)) throw works.reason
      const previous = queryClient.getQueryData<PageSnapshot>(queryKey)
      return {
        ...(queues.status === 'fulfilled' ? queues.value : (previous ?? initial)),
        queueError: queues.status === 'rejected' ? queues.reason : null,
        workRefreshed: works.status === 'fulfilled',
        works: works.status === 'fulfilled' ? works.value : (previous?.works ?? initialWork),
        workError: works.status === 'rejected' ? works.reason : (null as unknown),
        jobsError: jobs.status === 'rejected' ? jobs.reason : (null as unknown),
      }
    },
    initialData: {
      ...initial,
      works: initialWork,
      workError: null as unknown,
      jobsError: null as unknown,
    },
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

  // Every transition that leaves automatic fetching unadmitted (auto off, hidden, offline,
  // denied, cool-down) cancels queued or in-flight AUTOMATIC work, even when `admitted` was
  // already false: a request TanStack left paused offline must not resume on reconnect after
  // auto-refresh is switched off. A manual fetch survives, except after access loss.
  useEffect(() => {
    if (admitted || (manualInFlight.current && !denied)) return
    void queryClient.cancelQueries({ queryKey, exact: true }, { revert: true })
  }, [admitted, auto, denied, visible, online, queryClient])

  // Success: own the degraded streak (a 200 with every queue unavailable is not a success).
  useEffect(() => {
    if (!query.dataUpdatedAt || query.dataUpdatedAt === handled.current.data) return
    handled.current.data = query.dataUpdatedAt
    const at = Date.now()
    setNow(at)
    if (
      query.data &&
      (isDegraded(query.data) ||
        query.data.queueError ||
        query.data.workError ||
        query.data.jobsError)
    ) {
      const next = streak + 1
      setStreak(next)
      setFloors(
        floorsAfterFailure(
          at,
          next,
          retryAfterSecondsOf(query.data.queueError ?? query.data.workError ?? query.data.jobsError)
        )
      )
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
    data: denied
      ? null
      : query.data
        ? { checkedAt: query.data.checkedAt, board: query.data.board, queues: query.data.queues }
        : undefined,
    workRefreshed: !!query.data?.workRefreshed,
    works: denied ? undefined : query.data?.works,
    workError: query.data?.workError,
    partial: !!(query.data?.queueError || query.data?.workError || query.data?.jobsError),
    denied,
    auto,
    setAuto,
    online,
    isFetching: query.isFetching,
    /** The latest refresh failed: rows (if any) are older than the status line says. */
    refreshFailed: query.isError || !!query.data?.queueError,
    canRefresh: manualAllowed,
    retryAfterSeconds: Math.max(0, Math.ceil((floors.retryAfterUntil - now) / 1000)),
    refresh,
  }
}
