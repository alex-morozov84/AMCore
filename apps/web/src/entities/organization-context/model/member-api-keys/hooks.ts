import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { MemberKeyQuery } from '@amcore/shared'

import { memberKeysClient } from '../../api/member-api-keys-client'
import type { OrganizationAccessController } from '../access-controller'
import { useOrganizationRead } from '../use-organization-read'

import 'client-only'

export const memberKeyRejectionCodes = new Set([
  'MEMBER_UNAVAILABLE',
  'MEMBER_ROLES_CONFLICT',
  'MEMBER_ROLE_ASSIGNMENT_DENIED',
  'ORGANIZATION_LAST_ADMIN',
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'AUTH_ORIGIN_REJECTED',
  'CONTEXT_SESSION_CHANGED',
  'RATE_LIMIT_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'MEMBER_API_KEY_UNAVAILABLE',
  'MEMBER_API_KEYS_CONFLICT',
  'MEMBER_API_KEYS_LIMIT',
])
export function useMemberApiKeys(
  controller: OrganizationAccessController,
  userId: string,
  query: MemberKeyQuery
) {
  const orgId = controller.organizationId
  const target = JSON.stringify([controller.binding, orgId, userId, query.expectedMemberId])
  const lease = useRef<string | undefined>(target)
  useEffect(() => {
    lease.current = target
    return () => {
      lease.current = undefined
    }
  }, [target])
  const read = useOrganizationRead(
    controller,
    JSON.stringify([target, query]),
    (signal) => memberKeysClient.list(controller.binding, orgId, userId, query, signal),
    { namespace: 'member-api-keys', timeoutMs: 20000 }
  )
  const busy = useSyncExternalStore(
    controller.subscribe,
    () => controller.isBusy(query.expectedMemberId),
    () => false
  )
  const revoke = useCallback(
    async (keyId?: string) => {
      if (lease.current !== target) return { status: 'retired' as const }
      const result = await controller.execute(
        query.expectedMemberId,
        (signal) =>
          memberKeysClient.revoke(
            controller.binding,
            orgId,
            userId,
            { expectedMemberId: query.expectedMemberId },
            signal,
            keyId
          ),
        { timeoutMs: 20000, rejectionCodes: memberKeyRejectionCodes }
      )
      return lease.current === target ? result : { status: 'retired' as const }
    },
    [controller, orgId, userId, query.expectedMemberId, target]
  )
  return { ...read, busy, revoke }
}
