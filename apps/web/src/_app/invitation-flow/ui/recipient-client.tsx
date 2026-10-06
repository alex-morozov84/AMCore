'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { InvitationFlowBinding, UserResponse } from '@amcore/shared'

import { RecipientAuth, RecipientSkeleton, RecipientStatus } from '@/_pages/invitation-recipient'
import {
  type InvitationAcceptDescriptor,
  invitationFlowClient,
  useInvitationFlow,
} from '@/entities/invitation-flow'
import type { OAuthActionProvider } from '@/features/auth-oauth'
import { authApi } from '@/shared/api'
import { getErrorCode } from '@/shared/api/errors'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import { invitationOrganizationHref, type InvitationPlacement } from '../model/placement'
import { useRecipientAuthentication } from '../model/use-recipient-authentication'

import { ConsentJourney } from './consent-journey'
import { RecipientOAuthScope } from './recipient-oauth-scope'
import { SettlementResult } from './settlement-result'
import { InvitationUnavailableClient } from './unavailable-client'

/** Ready application composition. Downstreams may instead render their own public headless/feature APIs. */
export function RecipientClient({
  binding: initial,
  user,
  providers,
  placement,
  oauthContent,
}: {
  binding: InvitationFlowBinding
  user: UserResponse | null
  oauthContent?: ReactNode
  providers: OAuthActionProvider[]
  placement: InvitationPlacement
}) {
  const t = useTranslations('invitationRecipient')
  const router = useRouteProgressRouter()
  const auth = useRecipientAuthentication(initial, user)
  const [terminal, setTerminal] = useState<{
    descriptor: InvitationAcceptDescriptor
    organization: string
  } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>()
  const query = useInvitationFlow(auth.binding, auth.phase === 'active' && !terminal)
  const response = query.current
  const code = getErrorCode(query.error)
  const { observePending, retire } = auth
  useEffect(() => {
    if (response && 'state' in response)
      observePending(
        response.binding,
        response.state,
        response.state === 'completing_signin' ? response.handoff.attemptId : undefined
      )
    if (code === 'INVITE_FLOW_CHANGED' || query.bindingChanged) retire()
  }, [response, code, query.bindingChanged, observePending, retire])
  const leave = () => {
    auth.retire()
    router.push(placement.leaveHref)
  }
  const open = (id: string) => router.push(invitationOrganizationHref(placement, id))
  async function action(work: () => Promise<void>) {
    if (actionBusy) return
    const captured = auth.capture()
    setActionBusy(true)
    setActionError(undefined)
    try {
      await work()
    } catch (error) {
      if (auth.current(captured)) setActionError(error)
    } finally {
      if (auth.current(captured)) setActionBusy(false)
    }
  }
  const switchAccount = () =>
    action(async () => {
      const captured = auth.capture()
      const result = await invitationFlowClient.switchAccount(
        auth.binding,
        AbortSignal.timeout(15000)
      )
      if (auth.current(captured)) {
        auth.signedOut(result.binding)
        setActionBusy(false)
      }
    })
  const verify = () =>
    action(async () => {
      const captured = auth.capture()
      const result = await invitationFlowClient.verificationStatus(
        auth.binding,
        AbortSignal.timeout(10000)
      )
      if (auth.current(captured)) {
        auth.updateUser(result.data.user)
        await query.refetch()
      }
    })
  const resend = () =>
    action(async () => {
      if (auth.user) await authApi.resendVerification({ email: auth.user.email })
    })
  const oauth = (provider: OAuthActionProvider) =>
    action(async () => {
      const captured = auth.capture()
      const result = await invitationFlowClient.oauth(
        auth.binding,
        provider,
        AbortSignal.timeout(15000)
      )
      if (auth.current(captured)) window.location.assign(result.authorizeHref)
    })
  const verificationHelp = () =>
    action(async () => {
      const captured = auth.capture()
      const result = await invitationFlowClient.verificationReturnLink(
        auth.binding,
        AbortSignal.timeout(10000)
      )
      const selector = new URL(result.verifyHref, window.location.origin).searchParams.get(
        'inviteReturn'
      )
      if (auth.current(captured) && selector) router.push(`/verify-email?inviteReturn=${selector}`)
    })
  if (terminal) return <SettlementResult {...terminal} onLeave={leave} onOpen={open} />
  if (auth.phase === 'unusable') return <RecipientStatus state="unusable" onLeave={leave} />
  if (auth.phase === 'retired') return <RecipientStatus state="changed" onLeave={leave} />
  if (auth.phase === 'authenticating')
    return (
      <RecipientStatus
        state="authenticating"
        busy={auth.busy}
        error={auth.error}
        onRefresh={() => {
          void auth.recover()
        }}
        onLeave={leave}
      />
    )
  if (auth.phase === 'completing_signin')
    return (
      <RecipientStatus
        state="completing_signin"
        busy={auth.busy}
        error={auth.error}
        onConfirm={() => {
          void auth.recover()
        }}
        onLeave={leave}
      />
    )
  if (query.isFetching || query.isPending || (response && 'state' in response))
    return (
      <RecipientSkeleton
        kind={auth.binding.sessionBinding ? 'consent' : 'auth'}
        label={t('loading')}
      />
    )
  if (query.isError || !response) {
    if (code === 'INVITE_ACCOUNT_MISMATCH' && auth.user)
      return (
        <RecipientStatus
          state="wrong_account"
          email={auth.user.email}
          busy={actionBusy}
          error={actionError}
          onSwitch={() => {
            void switchAccount()
          }}
          onLeave={leave}
        />
      )
    if (code === 'INVITE_INVALID_OR_EXPIRED' || code === 'INVITE_ROLE_INTENT_INVALID')
      return <InvitationUnavailableClient flowId={auth.binding.flowId} placement={placement} />
    return (
      <InvitationUnavailableClient
        flowId={auth.binding.flowId}
        placement={placement}
        unavailable
        error={query.error}
        onRefresh={() => {
          void query.refetch()
        }}
      />
    )
  }
  const data = response.data
  if (!('state' in data))
    return (
      <RecipientOAuthScope.Provider
        value={{
          busy: actionBusy,
          onChoose: (provider) => {
            void oauth(provider)
          },
        }}
      >
        <RecipientAuth
          oauthContent={oauthContent}
          email={data.email}
          busy={actionBusy}
          error={actionError ?? auth.error}
          {...auth.adapters}
          oauth={{
            providers,
            onChoose: (provider) => {
              void oauth(provider)
            },
          }}
          onLeave={leave}
        />
      </RecipientOAuthScope.Provider>
    )
  if (data.state === 'verify_email')
    return (
      <RecipientStatus
        state="verify_email"
        email={data.email}
        busy={actionBusy}
        error={actionError}
        onRefresh={() => {
          void verify()
        }}
        onResend={() => {
          void resend()
        }}
        onHelp={() => {
          void verificationHelp()
        }}
        onLeave={leave}
      />
    )
  if (data.state === 'already_access')
    return (
      <RecipientStatus
        state="already_access"
        organization={data.organization.name}
        onOpen={() => open(data.organization.id)}
        onLeave={leave}
      />
    )
  if (!auth.user) return <RecipientStatus state="changed" onLeave={leave} />
  return (
    <ConsentJourney
      binding={auth.binding}
      invitation={data}
      user={auth.user}
      onLeave={leave}
      onOpen={open}
      onSettled={(_result, descriptor) =>
        setTerminal({ descriptor, organization: data.organization.name })
      }
    />
  )
}
