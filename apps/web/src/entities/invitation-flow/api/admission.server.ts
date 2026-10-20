import { invitationFlowIdSchema } from '@amcore/shared'

import { withinContextDeadline } from '@/shared/api/bff/context-deadline'
import { invitationContextDeps } from '@/shared/api/bff/invitation-context-deps'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from '@/shared/api/bff/invitation-request-snapshot'

import 'server-only'

/** Safe server admission for custom recipient screens; secrets and vault IDs never leave this DAL. */
export function readInvitationRecipientAdmission(request: Request, flowId: string) {
  return withinContextDeadline(
    request.signal,
    async (signal) => {
      const id = invitationFlowIdSchema.parse(flowId)
      const snapshot = await captureInvitationRequest(
        request,
        id,
        await invitationContextDeps(request, { flowId })
      )
      await assertInvitationReadCurrent(snapshot)
      signal.throwIfAborted()
      return { binding: snapshot.flow.binding, user: snapshot.session?.entry.userSnapshot ?? null }
    },
    10000
  )
}
