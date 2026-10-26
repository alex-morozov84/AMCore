import { headers } from 'next/headers'
import { invitationFlowIdSchema } from '@amcore/shared'

import { ClientMessages } from '@/i18n/client-message-boundary'
import { invitationContextDeps } from '@/shared/api/bff/invitation-context-deps'
import { invitationRenderRequest } from '@/shared/api/bff/invitation-render-request'
import { invitationRequestAuthority } from '@/shared/api/bff/invitation-request-authority'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from '@/shared/api/bff/invitation-request-snapshot'
import { readInvitationVerificationSelector } from '@/shared/api/bff/invitation-verification-store'
import { degradeSecondary } from '@/shared/api/server'
import { SectionErrorBoundary } from '@/shared/ui/section-error-boundary'

import {
  invitationUnavailableOutcome,
  isExpectedInvitationState,
} from '../model/render-outcome.server'

import { InvitationVerificationClient, VerificationReturn } from './verification-return-client'

import 'server-only'

/** The selector supplies no identity: only the current owner and opaque app session can admit return. */
async function AdmittedVerificationReturn({
  selectorId,
  admin,
}: {
  selectorId: string
  admin: boolean
}) {
  let binding: string | null = null
  if (!invitationFlowIdSchema.safeParse(selectorId).success)
    return <VerificationReturn selectorId={selectorId} sessionBinding={null} admin={admin} />
  try {
    const request = invitationRenderRequest(new Headers(await headers()), selectorId)
    const deps = await invitationContextDeps(request, { verificationId: selectorId })
    const authority = invitationRequestAuthority(request, false, deps.webContext)
    if (authority.ownerHash) {
      const record = await readInvitationVerificationSelector(
        selectorId,
        authority.ownerHash,
        authority.policy.origin,
        deps.webContext
      )
      if (record) {
        const snapshot = await captureInvitationRequest(request, record.binding.flowId, deps)
        if (
          snapshot.session &&
          snapshot.session.binding === record.binding.sessionBinding &&
          snapshot.owner.epoch === record.ownerEpoch &&
          snapshot.flow.binding.flowRevision === record.binding.flowRevision
        ) {
          await assertInvitationReadCurrent(snapshot)
          binding = snapshot.session.binding
        }
      }
    }
  } catch (error) {
    if (!isExpectedInvitationState(error)) {
      const outcome = invitationUnavailableOutcome(error)
      if (!outcome) throw error
      degradeSecondary(outcome, { source: 'invitation-verification-return' })
    }
  }
  return <VerificationReturn selectorId={selectorId} sessionBinding={binding} admin={admin} />
}

/** The optional selector cannot own ordinary verification's form or result. */
export function InvitationVerificationMount({
  token,
  selectorId,
  admin = false,
}: {
  token?: string
  selectorId: string
  admin?: boolean
}) {
  return (
    <ClientMessages namespaces={['invitationRecipient']}>
      <InvitationVerificationClient
        token={token}
        admin={admin}
        selectorId={selectorId}
        sessionBinding={null}
        successContent={
          <SectionErrorBoundary>
            <AdmittedVerificationReturn selectorId={selectorId} admin={admin} />
          </SectionErrorBoundary>
        }
      />
    </ClientMessages>
  )
}
