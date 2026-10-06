'use client'

import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'

import { RecipientSkeleton, RecipientStatus } from '@/_pages/invitation-recipient'
import { type InvitationAcceptDescriptor, invitationFlowClient } from '@/entities/invitation-flow'

/** A durable proof validates the current actor and live membership after consent or reload recovery. */
export function SettlementResult({
  descriptor,
  organization,
  onLeave,
  onOpen,
}: {
  descriptor: InvitationAcceptDescriptor
  organization?: string
  onLeave(): void
  onOpen(id: string): void
}) {
  const t = useTranslations('invitationRecipient')
  const query = useQuery({
    queryKey: ['invitation-settlement', descriptor.operationId],
    queryFn: ({ signal }) => invitationFlowClient.recover(descriptor.operationId, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  })
  if (query.isFetching || query.isPending)
    return <RecipientSkeleton kind="consent" label={t('loading')} />
  if (query.isError)
    return (
      <RecipientStatus
        state="unavailable"
        busy={false}
        error={query.error}
        onRefresh={() => {
          void query.refetch()
        }}
        onLeave={onLeave}
      />
    )
  const receipt = query.data
  if (!receipt || receipt.state === 'unknown')
    return (
      <RecipientStatus
        state="unresolved"
        busy={false}
        onRefresh={() => {
          void query.refetch()
        }}
        onLeave={onLeave}
      />
    )
  if (
    receipt.intent.expectedInviteId !== descriptor.expectedInviteId ||
    receipt.intent.expectedGeneration !== descriptor.expectedGeneration
  )
    return <RecipientStatus state="changed" onLeave={onLeave} />
  if (receipt.access === 'removed')
    return <RecipientStatus state="access_removed" onLeave={onLeave} />
  return (
    <RecipientStatus
      state={receipt.result.status === 'accepted' ? 'joined' : 'already_access'}
      organization={organization ?? t('organizationLabel')}
      onOpen={() => onOpen(receipt.result.organizationId)}
      onLeave={onLeave}
    />
  )
}
