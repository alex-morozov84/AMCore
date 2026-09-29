import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import { organizationContextClient, type OrganizationContextData } from '../api/context-client'

import {
  type OrganizationContextInput,
  organizationContextKey,
  organizationContextTarget,
} from './context-input'
import { createOrganizationContextScheduler } from './context-scheduler'

import 'client-only'

export function useOrganizationContext(binding: string, input: OrganizationContextInput) {
  const client = useQueryClient()
  const [initialInput] = useState(input)
  const scheduler = useMemo(
    () =>
      createOrganizationContextScheduler(binding, initialInput, {
        ...organizationContextClient,
        publish: (target, data) =>
          client.setQueryData(organizationContextKey(binding, target), data),
      }),
    [binding, client, initialInput]
  )
  const state = useSyncExternalStore(
    scheduler.subscribe,
    scheduler.getSnapshot,
    scheduler.getSnapshot
  )
  const query = useQuery<OrganizationContextData>({
    queryKey: organizationContextKey(binding, input),
    queryFn: skipToken,
    enabled: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const target = organizationContextTarget(input)
  useEffect(() => {
    scheduler.setInput(input)
  }, [scheduler, input])
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') scheduler.activate()
    }
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) scheduler.activate()
    }
    scheduler.activate()
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pageshow', pageShow)
    return () => {
      scheduler.stop()
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pageshow', pageShow)
    }
  }, [scheduler])
  return {
    state: state.target === target ? state : { target, status: 'pending' as const },
    data: state.target === target && state.status === 'ready' ? query.data : undefined,
    refresh: () => scheduler.activate(),
    action: scheduler.action,
  }
}
