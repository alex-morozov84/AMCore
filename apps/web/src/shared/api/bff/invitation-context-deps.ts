import { invitationFlowIdSchema, PRODUCT_ADMIN_CONFIG } from '@amcore/shared'

import { invitationFlowChanged } from './invitation-flow-authority'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'
import { readInvitationVerificationSelector } from './invitation-verification-store'
import { productContextDeps } from './product-context-deps'

import 'server-only'

/** A flow selector chooses only a journal already proved by its own browser cookie. */
export async function invitationContextDeps(
  request: Request,
  selector: { flowId: string } | { verificationId: string }
) {
  const id = invitationFlowIdSchema.parse(
    'flowId' in selector ? selector.flowId : selector.verificationId
  )
  const base = productContextDeps(request.headers)
  const candidates =
    base.webContext?.audience === 'staff'
      ? [productContextDeps(request.headers, 'admin-invite')]
      : PRODUCT_ADMIN_CONFIG.mode === 'path'
        ? [
            productContextDeps(request.headers, 'legacy-invite'),
            productContextDeps(request.headers, 'admin-invite'),
          ]
        : [productContextDeps(request.headers, 'legacy-invite')]
  const matches = []
  for (const deps of candidates) {
    const authority = invitationRequestAuthority(request, false, deps.webContext)
    if (!authority.ownerHash) continue
    const owner = await invitationOwnerStore.get(
      authority.ownerHash,
      authority.policy.origin,
      deps.webContext
    )
    if (!owner) continue
    if ('flowId' in selector) {
      if (owner.flows.some((flow) => flow.binding.flowId === id)) matches.push(deps)
    } else {
      const pending = await readInvitationVerificationSelector(
        id,
        authority.ownerHash,
        authority.policy.origin,
        deps.webContext
      )
      if (pending && owner.flows.some((flow) => flow.binding.flowId === pending.binding.flowId))
        matches.push(deps)
    }
  }
  if (matches.length !== 1) throw invitationFlowChanged()
  return matches[0]!
}
