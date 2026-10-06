import { useEffect } from 'react'
import type { InvitationFlowBinding } from '@amcore/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { invitationFlowClient } from '../api/flow-client'

import 'client-only'

export type InvitationFlowRead =
  | Awaited<ReturnType<typeof invitationFlowClient.context>>
  | Awaited<ReturnType<typeof invitationFlowClient.inspect>>

export function invitationFlowQueryKey(
  binding: InvitationFlowBinding,
  kind: 'context' | 'inspect'
) {
  return [
    'invitation-flow',
    binding.flowId,
    binding.flowRevision,
    binding.sessionBinding,
    kind,
  ] as const
}

/** Current authority is primary: hide prior summaries during activation/refetch and on any failure. */
export function useInvitationFlow(binding: InvitationFlowBinding, enabled = true) {
  const kind = binding.sessionBinding === null ? 'context' : 'inspect'
  const key = invitationFlowQueryKey(binding, kind)
  const client = useQueryClient()
  const query = useQuery<InvitationFlowRead>({
    queryKey: key,
    queryFn: ({ signal }) => invitationFlowClient[kind](binding.flowId, signal),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  })
  useEffect(() => {
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted)
        void client.invalidateQueries({ queryKey: ['invitation-flow', binding.flowId] })
    }
    window.addEventListener('pageshow', pageShow)
    return () => {
      window.removeEventListener('pageshow', pageShow)
    }
  }, [client, binding.flowId])
  const response = query.data
  const matches =
    response?.binding.flowId === binding.flowId &&
    response.binding.flowRevision === binding.flowRevision &&
    response.binding.sessionBinding === binding.sessionBinding
  // Known auth transitions are adopted by application composition, never silently by an ordinary read.
  return {
    ...query,
    current: matches && !query.isFetching && !query.isError ? response : undefined,
    bindingChanged: Boolean(response && !matches),
  }
}
