import { Suspense } from 'react'
import { headers } from 'next/headers'
import { invitationFlowIdSchema } from '@amcore/shared'

import { RecipientFrame } from '@/_pages/invitation-recipient'
import { readInvitationRecipientAdmission } from '@/entities/invitation-flow/index.server'
import { invitationRenderRequest } from '@/shared/api/bff/invitation-render-request'
import { resolvePrimary } from '@/shared/api/server'
import { SectionErrorBoundary } from '@/shared/ui/section-error-boundary'

import { type InvitationPlacement, invitationPlacement } from '../model/placement'
import {
  invitationUnavailableOutcome,
  isExpectedInvitationState,
} from '../model/render-outcome.server'

import { RecipientClient } from './recipient-client'
import { RecipientOAuthSection } from './recipient-oauth-section'
import { InvitationUnavailableClient } from './unavailable-client'

import 'server-only'

/** Admit current owner/session and flow existence before passing any personal data to interactive UI. */
export async function InvitationRecipientMount({
  flowId,
  placement = invitationPlacement,
}: {
  flowId: string
  placement?: InvitationPlacement
}) {
  let admission
  if (!invitationFlowIdSchema.safeParse(flowId).success)
    return (
      <RecipientFrame>
        <InvitationUnavailableClient placement={placement} />
      </RecipientFrame>
    )
  try {
    const id = invitationFlowIdSchema.parse(flowId)
    const request = invitationRenderRequest(new Headers(await headers()), id)
    admission = await readInvitationRecipientAdmission(request, id)
  } catch (error) {
    if (isExpectedInvitationState(error))
      return (
        <RecipientFrame>
          <InvitationUnavailableClient flowId={flowId} placement={placement} />
        </RecipientFrame>
      )
    const outcome = invitationUnavailableOutcome(error)
    if (!outcome) throw error
    resolvePrimary(outcome, { source: 'invitation-recipient' })
    return (
      <RecipientFrame>
        <InvitationUnavailableClient flowId={flowId} unavailable placement={placement} />
      </RecipientFrame>
    )
  }
  return (
    <RecipientFrame>
      <RecipientClient
        binding={admission.binding}
        user={admission.user}
        providers={[]}
        placement={placement}
        oauthContent={
          <Suspense fallback={null}>
            <SectionErrorBoundary>
              <RecipientOAuthSection />
            </SectionErrorBoundary>
          </Suspense>
        }
      />
    </RecipientFrame>
  )
}

export function InvitationUnusableMount({
  unavailable = false,
  placement = invitationPlacement,
}: {
  unavailable?: boolean
  placement?: InvitationPlacement
}) {
  return (
    <RecipientFrame>
      <InvitationUnavailableClient unavailable={unavailable} placement={placement} />
    </RecipientFrame>
  )
}
