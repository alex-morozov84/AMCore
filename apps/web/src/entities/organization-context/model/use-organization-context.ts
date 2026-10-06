import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import { organizationContextClient, type OrganizationContextData } from '../api/context-client'

import {
  type OrganizationContextInput,
  organizationContextKey,
  organizationContextTarget,
} from './context-input'
import { createOrganizationContextScheduler } from './context-scheduler'
import {
  type AuthorityRefreshResult,
  createOrganizationAccessController,
} from './members/controller'

import 'client-only'

export function useOrganizationContext(binding: string, input: OrganizationContextInput) {
  const client = useQueryClient()
  const [initialInput] = useState(input)
  const ownerTarget = input.kind === 'selected' ? input.id : 'list'
  const controller = useMemo(
    () => createOrganizationAccessController(binding, ownerTarget),
    [binding]
  )
  const scheduler = useMemo(
    () =>
      createOrganizationContextScheduler(binding, initialInput, {
        ...organizationContextClient,
        beforeAuthority: controller.waitTransports,
        publish: (target, data) =>
          client.setQueryData(organizationContextKey(binding, target), data),
      }),
    [binding, client, initialInput, controller]
  )
  const state = useSyncExternalStore(
    scheduler.subscribe,
    scheduler.getSnapshot,
    scheduler.getSnapshot
  )
  const initialPending = useSyncExternalStore(scheduler.subscribe, scheduler.isInitialPending, () => true)
  const query = useQuery<OrganizationContextData>({
    queryKey: organizationContextKey(binding, input),
    queryFn: skipToken,
    enabled: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  controller.setRefresh(async (signal) => {
    const captured = controller.capture()
    const status = await scheduler.refresh(signal)
    signal?.throwIfAborted()
    if (!controller.current(captured) || status === 'retired') return 'retired'
    const fresh = client.getQueryData<OrganizationContextData>(
      organizationContextKey(binding, input)
    )?.data
    const ready =
      status === 'ready' && fresh && 'canManageTeamAccess' in fresh && fresh.canManageTeamAccess
    controller.setAuthority(Boolean(ready))
    return (status === 'ready' && !ready ? 'denied' : status) as AuthorityRefreshResult
  })
  const busy = useSyncExternalStore(
    controller.subscribe,
    () => controller.isBusy(),
    () => false
  )
  const target = organizationContextTarget(input)
  useEffect(() => {
    controller.setTarget(ownerTarget)
    scheduler.setInput(input)
  }, [scheduler, input, controller, ownerTarget])
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') scheduler.activate()
    }
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) scheduler.activate()
    }
    controller.resume()
    scheduler.activate()
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pageshow', pageShow)
    return () => {
      controller.retire()
      scheduler.stop()
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pageshow', pageShow)
    }
  }, [scheduler, controller])
  useEffect(() => {
    const data = query.data?.data
    const ready =
      state.status === 'ready' && data && 'canManageTeamAccess' in data && data.canManageTeamAccess
    controller.setAuthority(Boolean(ready))
    if (state.status === 'changed' || state.status === 'missing') controller.retire()
  }, [controller, state.status, query.data])
  return {
    controller,
    initialPending,
    busy,
    state: state.target === target ? state : { target, status: 'pending' as const },
    data: state.target === target && state.status === 'ready' ? query.data : undefined,
    refresh: () => controller.refresh(),
    action: scheduler.action,
  }
}
