import { type QueryClient, queryOptions } from '@tanstack/react-query'

import { getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { withDeadline } from '@/shared/lib/with-deadline'

import type { OrganizationContextData } from '../api/context-client'

export const organizationReadKey = (namespace: string, identity: string) =>
  [namespace, identity] as const

export function assertReadCooldown(client: QueryClient, key: readonly unknown[]) {
  const state = client.getQueryState(key)
  if (state?.error && Date.now() < state.errorUpdatedAt + (getRetryAfterMs(state.error) ?? 0))
    throw state.error
}

/** Cancelling resource data cannot restore a separately revoked admission. */
export function refuseOrganizationAdmission(client: QueryClient, binding: string, orgId: string) {
  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === 'organization-context' &&
    queryKey[1] === binding &&
    String(queryKey[2]).startsWith(`selected:${orgId}:`)
  client.setQueriesData<OrganizationContextData>({ predicate }, (previous) =>
    previous && 'canManageTeamAccess' in previous.data
      ? { ...previous, data: { ...previous.data, canManageTeamAccess: false } }
      : previous
  )
  void client.invalidateQueries({ predicate, refetchType: 'none' })
}

export function organizationReadOptions<T>(
  key: readonly [string, string],
  load: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 5000
) {
  return queryOptions({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const deadline = new AbortController()
      const combined = AbortSignal.any([signal, deadline.signal])
      const data = await withDeadline(load(combined), timeoutMs, deadline)
      combined.throwIfAborted()
      return data
    },
    staleTime: 60000,
    retry: false,
    retryOnMount: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const isOrganizationRefusal = (error: unknown) =>
  [401, 403, 409].includes(getErrorStatus(error) ?? 0)
