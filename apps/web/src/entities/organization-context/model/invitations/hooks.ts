import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { InviteListQuery, InviteRoleChoicesQuery } from '@amcore/shared'
import { invitationOperationTimestamp } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { invitationsClient } from '../../api/invitations-client'
import type { OrganizationAccessController } from '../access-controller'
import { invitationEffects, refreshOrganizationEffects } from '../read-effects'
import { useOrganizationRead } from '../use-organization-read'

import { createInvitationManagerOperations } from './operations-controller'

import 'client-only'

export function useOrganizationInvitations(
  controller: OrganizationAccessController,
  query: InviteListQuery
) {
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId, query])
  return useOrganizationRead(
    controller,
    identity,
    (signal) => invitationsClient.list(binding, readOrganizationId, query, signal),
    { namespace: 'organization-invitations', timeoutMs: 10000 }
  )
}
export function useInvitationRoleChoices(
  controller: OrganizationAccessController,
  query: InviteRoleChoicesQuery
) {
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId, query])
  return useOrganizationRead(
    controller,
    identity,
    (signal) => invitationsClient.roles(binding, readOrganizationId, query, signal),
    { namespace: 'organization-invitation-roles', timeoutMs: 10000, secondary: true }
  )
}
export function useInvitationManagerOperations(access: OrganizationAccessController) {
  const organizationId = access.organizationId
  const client = useQueryClient()
  const refresh = useCallback(
    () =>
      refreshOrganizationEffects(client, access, invitationEffects, undefined, async () =>
        access.allowed() ? 'ready' : access.refreshAuthority()
      ),
    [client, access, organizationId]
  )
  const controller = useMemo(
    () => createInvitationManagerOperations(access, undefined, undefined, refresh),
    [access, organizationId, refresh]
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot
  )
  useEffect(() => {
    controller.resume()
    const epoch = access.capture()
    const unsubscribe = access.subscribe(() => {
      if (!access.current(epoch)) controller.retire()
    })
    return () => {
      unsubscribe()
      controller.retire()
    }
  }, [controller, access])
  useEffect(() => {
    if (!state.record || state.status !== 'unknown') return
    const timer = setTimeout(
      () => controller.expire(),
      Math.max(0, invitationOperationTimestamp(state.record.operationId) + 86400000 - Date.now())
    )
    return () => clearTimeout(timer)
  }, [controller, state.record, state.status])
  return { ...state, controller }
}
