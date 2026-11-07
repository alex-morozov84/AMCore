import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { getRetryAfterMs } from '@/shared/api/errors'
import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'

import type { OrganizationAccessController } from './access-controller'
import {
  assertReadCooldown,
  isOrganizationRefusal,
  organizationReadKey,
  organizationReadOptions,
  refuseOrganizationAdmission,
} from './read-options'

import 'client-only'

/** Query owns shared reads; controllers own command admission, and forms own drafts. */
export function useOrganizationRead<T>(
  controller: OrganizationAccessController,
  identity: string,
  load: (signal: AbortSignal) => Promise<T>,
  options?: { namespace: string; timeoutMs: number; secondary?: boolean }
) {
  const client = useQueryClient()
  const { binding, organizationId } = controller
  const key = useMemo(
    () => organizationReadKey(options?.namespace ?? 'organization-members', identity),
    [identity, options?.namespace]
  )
  const ready = useSyncExternalStore(controller.subscribe, controller.allowed, controller.allowed)
  const definition = organizationReadOptions(key, load, options?.timeoutMs)
  const query = useQuery({
    ...definition,
    enabled: (entry) => ready && entry.state.status !== 'error',
  })
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return
        const entry = event.query
        if (entry.queryKey[0] !== key[0] || entry.queryKey[1] !== key[1]) return
        if (isOrganizationRefusal(entry.state.error)) {
          controller.setAuthority(false)
          refuseOrganizationAdmission(client, binding, organizationId)
        }
      }),
    [client, controller, key, binding, organizationId]
  )
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      signal?.throwIfAborted()
      const epoch = controller.capture()
      assertReadCooldown(client, key)
      const result = await query.refetch({ cancelRefetch: false, throwOnError: true })
      signal?.throwIfAborted()
      return controller.current(epoch) ? result.data : undefined
    },
    [client, controller, key, query.refetch]
  )
  useEffect(
    () =>
      controller.registerRead(
        options?.secondary ? (signal) => refresh(signal).catch(() => undefined) : refresh
      ),
    [controller, refresh, options?.secondary]
  )
  // Explicit review requires an uncancelled observation, not cancellation's cached fallback.
  async function review(signal?: AbortSignal) {
    const epoch = controller.capture()
    signal?.throwIfAborted()
    assertReadCooldown(client, key)
    await client.cancelQueries({ queryKey: key, exact: true })
    let observed: AbortSignal | undefined
    const result = await client.fetchQuery({
      ...definition,
      staleTime: 0,
      queryFn: (context) => {
        observed = context.signal
        return definition.queryFn!(context)
      },
    })
    signal?.throwIfAborted()
    if (!observed || observed.aborted || !controller.current(epoch) || !controller.allowed())
      throw new Error('REVIEW_CANCELLED')
    return result
  }
  const deadline = query.errorUpdatedAt + (getRetryAfterMs(query.error) ?? 0)
  const cooling = useRetryDeadline(deadline)
  return {
    identity,
    data: ready ? query.data : undefined,
    retainedData: controller.current(controller.capture()) ? query.data : undefined,
    error: query.error ?? undefined,
    pending: ready && query.isPending && !query.error,
    fetching: query.isFetching,
    ready,
    available: ready && query.data !== undefined && !query.error,
    refresh,
    review,
    retryAt: cooling ? deadline : undefined,
  }
}
