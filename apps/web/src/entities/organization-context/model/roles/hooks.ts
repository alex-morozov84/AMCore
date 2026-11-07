import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { CreateRoleDefinition, DeleteRoleDefinition, SaveRoleDefinition } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { rolesClient } from '../../api/roles-client'
import type { OrganizationAccessController, OrganizationWriteOutcome } from '../members/controller'
import { refreshLegacyOrganizationEffects } from '../read-effects'
import { useOrganizationRead } from '../use-organization-read'

import {
  ROLE_REJECTION_CODES,
  type RoleCreateOutcome,
  type RoleDeleteOutcome,
  type RoleSaveOutcome,
} from './outcomes'

import 'client-only'

const READ = { timeoutMs: 5000 } as const
const OPERATION = { rejectionCodes: ROLE_REJECTION_CODES } as const
/** Operation keys are namespaced so role commands never collide with member or invitation ones. */
const roleKey = (roleId: string) => `roles:${roleId}`
const CREATE_KEY = 'roles:create'

function useBusy(controller: OrganizationAccessController, key?: string) {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.isBusy(key),
    () => false
  )
}

/** Retires a command when the session, organization or target changes under it. */
function useLease(identity: string) {
  const lease = useRef<string | undefined>(identity)
  useEffect(() => {
    lease.current = identity
    return () => {
      lease.current = undefined
    }
  }, [identity])
  return lease
}

/** The supported operations, presets and risk flags a role editor may offer. */
export function useCapabilityCatalogue(controller: OrganizationAccessController) {
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId])
  return useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.catalogue(binding, readOrganizationId, signal),
    { namespace: 'organization-capability-catalogue', ...READ }
  )
}

/** One member's effective access in this organization, as the server explains it. */
export function useMemberAccess(controller: OrganizationAccessController, userId: string) {
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId, userId])
  return useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.memberAccess(binding, readOrganizationId, userId, signal),
    { namespace: 'organization-member-access', ...READ }
  )
}

export function useRoleDefinitions(
  controller: OrganizationAccessController,
  query: { page: number; search: string }
) {
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId, query])
  const read = useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.list(binding, readOrganizationId, query, signal),
    { namespace: 'organization-role-definitions', ...READ }
  )
  return { ...read, busy: useBusy(controller) }
}

/** One role: its atomic snapshot plus the save and delete commands that fence on that snapshot. */
export function useRoleDefinition(controller: OrganizationAccessController, roleId: string) {
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId, roleId])
  const client = useQueryClient()
  const read = useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.detail(binding, readOrganizationId, roleId, signal),
    { namespace: 'organization-role-definition', ...READ }
  )
  const busy = useBusy(controller, roleKey(roleId))
  const organizationId = controller.organizationId
  const lease = useLease(identity)
  const run = useCallback(
    async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<OrganizationWriteOutcome<T>> => {
      if (lease.current !== identity) return { status: 'retired' }
      const outcome = await controller.execute(roleKey(roleId), work, {
        ...OPERATION,
        refresh: (signal) => refreshLegacyOrganizationEffects(client, controller, signal),
      })
      return lease.current === identity ? outcome : { status: 'retired' }
    },
    [client, controller, identity, lease, roleId]
  )
  const save = useCallback(
    (dto: SaveRoleDefinition): Promise<RoleSaveOutcome> =>
      run((signal) => rolesClient.save(controller.binding, organizationId, roleId, dto, signal)),
    [controller, organizationId, roleId, run]
  )
  const remove = useCallback(
    (dto: DeleteRoleDefinition): Promise<RoleDeleteOutcome> =>
      run((signal) => rolesClient.remove(controller.binding, organizationId, roleId, dto, signal)),
    [controller, organizationId, roleId, run]
  )
  return { ...read, busy, save, remove }
}

/** Creating an empty role; the new role's page is then read through `useRoleDefinition`. */
export function useCreateRoleDefinition(controller: OrganizationAccessController) {
  const client = useQueryClient()
  const { binding, organizationId: readOrganizationId } = controller
  const identity = JSON.stringify([binding, readOrganizationId])
  const busy = useBusy(controller, CREATE_KEY)
  const organizationId = controller.organizationId
  const lease = useLease(identity)
  const create = useCallback(
    async (dto: CreateRoleDefinition): Promise<RoleCreateOutcome> => {
      if (lease.current !== identity) return { status: 'retired' }
      const outcome = await controller.execute(
        CREATE_KEY,
        (signal) => rolesClient.create(controller.binding, organizationId, dto, signal),
        {
          ...OPERATION,
          refresh: (signal) => refreshLegacyOrganizationEffects(client, controller, signal),
        }
      )
      return lease.current === identity ? outcome : { status: 'retired' }
    },
    [client, controller, identity, lease, organizationId]
  )
  return { busy, create }
}
