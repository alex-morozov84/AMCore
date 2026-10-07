import { invitationFlowIdSchema } from '@amcore/shared'

import { withinContextDeadline } from '@/shared/api/bff/context-deadline'
import {
  assertInvitationReadCurrent,
  captureInvitationRequest,
} from '@/shared/api/bff/invitation-request-snapshot'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

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
        productContextDeps(request.headers)
      )
      await assertInvitationReadCurrent(snapshot)
      signal.throwIfAborted()
      return { binding: snapshot.flow.binding, user: snapshot.session?.entry.userSnapshot ?? null }
    },
    10000
  )
}
