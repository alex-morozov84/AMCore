import { headers } from 'next/headers'
import { invitationFlowIdSchema } from '@amcore/shared'

import { invitationRenderRequest } from '@/shared/api/bff/invitation-render-request'
import { invitationRequestAuthority } from '@/shared/api/bff/invitation-request-authority'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from '@/shared/api/bff/invitation-request-snapshot'
import { readInvitationVerificationSelector } from '@/shared/api/bff/invitation-verification-store'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { degradeSecondary } from '@/shared/api/server'
import { SectionErrorBoundary } from '@/shared/ui/section-error-boundary'

import {
  invitationUnavailableOutcome,
  isExpectedInvitationState,
} from '../model/render-outcome.server'

import { InvitationVerificationClient, VerificationReturn } from './verification-return-client'

import 'server-only'

/** The selector supplies no identity: only the current owner and opaque app session can admit return. */
async function AdmittedVerificationReturn({ selectorId }: { selectorId: string }) {
  let binding: string | null = null
  if (!invitationFlowIdSchema.safeParse(selectorId).success)
    return <VerificationReturn selectorId={selectorId} sessionBinding={null} />
  try {
    const request = invitationRenderRequest(new Headers(await headers()), selectorId)
    const authority = invitationRequestAuthority(request, false)
    if (authority.ownerHash) {
      const record = await readInvitationVerificationSelector(
        selectorId,
        authority.ownerHash,
        authority.policy.origin
      )
      if (record) {
        const snapshot = await captureInvitationRequest(
          request,
          record.binding.flowId,
          productContextDeps(request.headers)
        )
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
  return <VerificationReturn selectorId={selectorId} sessionBinding={binding} />
}

/** The optional selector cannot own ordinary verification's form or result. */
export function InvitationVerificationMount({
  token,
  selectorId,
}: {
  token?: string
  selectorId: string
}) {
  return (
    <InvitationVerificationClient
      token={token}
      selectorId={selectorId}
      sessionBinding={null}
      successContent={
        <SectionErrorBoundary>
          <AdmittedVerificationReturn selectorId={selectorId} />
        </SectionErrorBoundary>
      }
    />
  )
}
