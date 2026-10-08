import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { CreateRoleDefinition, DeleteRoleDefinition, SaveRoleDefinition } from '@amcore/shared'

import { rolesClient } from '../../api/roles-client'
import type { OrganizationAccessController, OrganizationWriteOutcome } from '../members/controller'
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
  const identity = JSON.stringify([controller.binding, controller.organizationId])
  return useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.catalogue(controller.binding, controller.organizationId, signal),
    { namespace: 'organization-capability-catalogue', ...READ }
  )
}

export function useRoleDefinitions(
  controller: OrganizationAccessController,
  query: { page: number; search: string }
) {
  const identity = JSON.stringify([controller.binding, controller.organizationId, query])
  const read = useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.list(controller.binding, controller.organizationId, query, signal),
    { namespace: 'organization-role-definitions', ...READ }
  )
  return { ...read, busy: useBusy(controller) }
}

/** One role: its atomic snapshot plus the save and delete commands that fence on that snapshot. */
export function useRoleDefinition(controller: OrganizationAccessController, roleId: string) {
  const identity = JSON.stringify([controller.binding, controller.organizationId, roleId])
  const read = useOrganizationRead(
    controller,
    identity,
    (signal) => rolesClient.detail(controller.binding, controller.organizationId, roleId, signal),
    { namespace: 'organization-role-definition', ...READ }
  )
  const busy = useBusy(controller, roleKey(roleId))
  const organizationId = controller.organizationId
  const lease = useLease(identity)
  const run = useCallback(
    async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<OrganizationWriteOutcome<T>> => {
      if (lease.current !== identity) return { status: 'retired' }
      const outcome = await controller.execute(roleKey(roleId), work, OPERATION)
      return lease.current === identity ? outcome : { status: 'retired' }
    },
    [controller, identity, lease, roleId]
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
  const identity = JSON.stringify([controller.binding, controller.organizationId])
  const busy = useBusy(controller, CREATE_KEY)
  const organizationId = controller.organizationId
  const lease = useLease(identity)
  const create = useCallback(
    async (dto: CreateRoleDefinition): Promise<RoleCreateOutcome> => {
      if (lease.current !== identity) return { status: 'retired' }
      const outcome = await controller.execute(
        CREATE_KEY,
        (signal) => rolesClient.create(controller.binding, organizationId, dto, signal),
        OPERATION
      )
      return lease.current === identity ? outcome : { status: 'retired' }
    },
    [controller, identity, lease, organizationId]
  )
  return { busy, create }
}
