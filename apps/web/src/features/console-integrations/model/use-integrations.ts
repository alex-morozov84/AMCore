'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { type IntegrationsResponse, integrationsResponseSchema } from '@amcore/shared'
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
 * Live Integrations list: one TanStack Query observer driven by the shared admission rule
 * (`@/shared/lib/console-poll-policy`). A refresh only rereads stored state; it never starts a
 * check or sends mail. 401/403 hide the rows at once, evict the cache and ask the Console frame to
 * re-admit once. A failed or unknown integration is a successful read: only a failed HTTP read
 * backs the polling off.
 */
export function useIntegrations(initial: IntegrationsResponse, initialUpdatedAt: number) {
  const instance = useId()
  const queryKey = ['console', 'integrations', 'list', instance]
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

  const admitted = isAdmitted({ auto, denied, visible, online, now, floors })

  const query = useQuery<IntegrationsResponse>({
    queryKey: denied ? [...queryKey, 'denied'] : queryKey,
    queryFn: async ({ signal }) =>
      integrationsResponseSchema.parse(await consoleApi.getIntegrations(signal)),
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

  const reportAccessLoss = useCallback(() => {
    if (accessLost.current) return
    accessLost.current = true
    setDenied(true)
    const predicate = (candidate: { queryKey: readonly unknown[] }): boolean =>
      candidate.queryKey[0] === 'console' &&
      candidate.queryKey[1] === 'integrations' &&
      candidate.queryKey.includes(instance)
    void queryClient.cancelQueries({ predicate })
    queryClient.removeQueries({ predicate })
    router.refresh()
  }, [instance, queryClient, router])

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
  }, [query.dataUpdatedAt])

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
    reportAccessLoss,
    denied,
    auto,
    setAuto,
    online,
    isFetching: query.isFetching,
    refreshFailed: query.isError,
    canRefresh: canRefreshManually({ denied, online, now, floors }),
    retryAfterSeconds: Math.max(0, Math.ceil((floors.retryAfterUntil - now) / 1000)),
    refresh,
  }
}
