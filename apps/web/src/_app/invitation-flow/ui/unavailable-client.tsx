'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { RecipientStatus } from '@/_pages/invitation-recipient'
import { useInvitationAcceptDescriptor } from '@/entities/invitation-flow'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'

import { invitationOrganizationHref,type InvitationPlacement } from '../model/placement'

import { SettlementResult } from './settlement-result'

/** No retained credential is needed for an explicit actor-bound receipt lookup. */
export function InvitationUnavailableClient({ flowId, unavailable = false, placement, error, onRefresh }: {
  flowId?: string; unavailable?: boolean; placement: InvitationPlacement; error?: unknown; onRefresh?(): void
}) {
  const t = useTranslations('invitationRecipient')
  const router = useRouteProgressRouter()
  const descriptor = useInvitationAcceptDescriptor(flowId)
  const [recovering, setRecovering] = useState(false)
  const leave = () => router.push(placement.leaveHref)
  if (recovering && descriptor) return <SettlementResult descriptor={descriptor} onLeave={leave}
    onOpen={id => router.push(invitationOrganizationHref(placement, id))} />
  return <>
    {unavailable ? <RecipientStatus state="unavailable" busy={false} error={error} onRefresh={onRefresh ?? (() => router.refresh())} onLeave={leave} />
      : <RecipientStatus state="unusable" onLeave={leave} />}
    {descriptor && <div className="mt-6 space-y-3" role="status">
      <p className="text-sm text-muted-foreground">{t('unknownOutcome')}</p>
      <Button variant="outline" onClick={() => setRecovering(true)}>{t('recover')}</Button>
    </div>}
  </>
}
