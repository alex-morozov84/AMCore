import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReplaceMemberRoles } from '@amcore/shared'

import { membersClient } from '../../api/members-client'

import type { OrganizationAccessController } from './controller'
import { useMemberRead } from './use-member-read'

import 'client-only'

export function useOrganizationMembers(
  controller: OrganizationAccessController,
  query: { page: number; search: string; roleId?: string }
) {
  const identity = JSON.stringify([controller.binding, controller.organizationId, query])
  const read = useMemberRead(controller, identity, (signal) =>
    membersClient.list(controller.binding, controller.organizationId, query, signal)
  )
  const busy = useSyncExternalStore(
    controller.subscribe,
    () => controller.isBusy(),
    () => false
  )
  return { ...read, busy }
}
export function useMemberRoleAssignments(
  controller: OrganizationAccessController,
  input: { userId: string; page: number; search: string; section: 'available' | 'assigned' }
) {
  const identity = JSON.stringify([controller.binding, controller.organizationId, input])
  const read = useMemberRead(controller, identity, (signal) =>
    membersClient.roles(controller.binding, controller.organizationId, input.userId, input, signal)
  )
  const busy = useSyncExternalStore(
    controller.subscribe,
    () => controller.isBusy(read.data?.member.memberId),
    () => false
  )
  const organizationId = controller.organizationId
  const targetIdentity = JSON.stringify([controller.binding, organizationId, input.userId])
  const targetLease = useRef<string | undefined>(targetIdentity)
  useEffect(() => {
    targetLease.current = targetIdentity
    return () => {
      targetLease.current = undefined
    }
  }, [targetIdentity])
  const save = useCallback(
    async (dto: ReplaceMemberRoles) => {
      if (targetLease.current !== targetIdentity) return { status: 'retired' as const }
      const outcome = await controller.save(dto.expectedMemberId, (signal) =>
        membersClient.save(controller.binding, organizationId, input.userId, dto, signal)
      )
      return targetLease.current === targetIdentity ? outcome : { status: 'retired' as const }
    },
    [controller, input.userId, organizationId, targetIdentity]
  )

  return { ...read, busy, save }
}
