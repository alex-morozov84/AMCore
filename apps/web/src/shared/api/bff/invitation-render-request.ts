import { trustedRequestOrigin } from './trusted-request-origin'

import 'server-only'

export { trustedRequestOrigin as invitationCanonicalOrigin } from './trusted-request-origin'

export function invitationRenderRequest(headers: Headers, flowId: string): Request {
  return new Request(`${trustedRequestOrigin(headers)}/api/invitation-flows/${encodeURIComponent(flowId)}/context`, { headers })
}
