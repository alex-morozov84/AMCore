'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import type {
  AcceptInviteResponse,
  InvitationFlowBinding,
  InvitationInspectResponse,
  UserResponse,
} from '@amcore/shared'

import { RecipientStatus } from '@/_pages/invitation-recipient'
import {
  createInvitationAcceptanceController,
  type InvitationAcceptDescriptor,
} from '@/entities/invitation-flow'
import { InvitationConsent } from '@/features/invitation-acceptance'

type Ready = Extract<InvitationInspectResponse, { state: 'ready' }>
export function ConsentJourney({
  binding,
  invitation,
  user,
  onLeave,
  onOpen,
  onSettled,
}: {
  binding: InvitationFlowBinding
  invitation: Ready
  user: UserResponse
  onLeave(): void
  onOpen(organizationId: string): void
  onSettled(result: AcceptInviteResponse, descriptor: InvitationAcceptDescriptor): void
}) {
  const t = useTranslations('invitationRecipient')
  const controller = useMemo(
    () =>
      createInvitationAcceptanceController(binding, {
        expectedInviteId: invitation.inviteId,
        expectedGeneration: invitation.generation,
      }),
    [binding, invitation.inviteId, invitation.generation]
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot
  )
  useEffect(() => {
    controller.resume()
    return () => {
      controller.retire()
    }
  }, [controller])
  useEffect(() => {
    if (state.status === 'committed' && state.result && state.descriptor)
      onSettled(state.result, state.descriptor)
  }, [state, onSettled])
  if (state.status === 'retired') return <RecipientStatus state="changed" onLeave={onLeave} />
  if (state.status === 'access_removed')
    return <RecipientStatus state="access_removed" onLeave={onLeave} />
  if (state.status === 'committed' && state.result)
    return (
      <RecipientStatus
        state={state.result.status === 'accepted' ? 'joined' : 'already_access'}
        organization={invitation.organization.name}
        onOpen={() => onOpen(state.result!.organizationId)}
        onLeave={onLeave}
      />
    )
  return (
    <>
      {!state.persistent && (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          {t('storageUnavailable')}
        </p>
      )}
      <InvitationConsent
        invitation={invitation}
        accountEmail={user.email}
        timeZone={user.timezone}
        state={
          state.status === 'pending' ? 'pending' : state.status === 'unknown' ? 'unknown' : 'idle'
        }
        error={state.error}
        onAccept={() => {
          void controller.accept()
        }}
        onRecover={() => {
          void controller.recover(true)
        }}
        onLeave={onLeave}
      />
    </>
  )
}
