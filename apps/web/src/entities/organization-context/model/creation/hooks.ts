import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ProductAccessBootstrap } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { organizationCreationClient } from '../../api/creation-client'

import { createOrganizationCreationController } from './controller'

import 'client-only'

export function useOrganizationCreation(admission: ProductAccessBootstrap, enabled = true) {
  const controller = useMemo(
    () => createOrganizationCreationController(admission),
    [admission.binding, admission.actor.id]
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  useEffect(() => {
    if (enabled) controller.hydrate()
    return controller.retire
  }, [controller, enabled])
  const policy = useQuery({
    queryKey: ['organization-creation-policy', admission.binding],
    queryFn: ({ signal }) => organizationCreationClient.policy(admission.binding, signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
    staleTime: 0,
  })
  return {
    state,
    controller,
    policy,
    blocksAutoOpen: enabled && (state.phase === 'hydrating' || !!state.attempt),
  }
}
