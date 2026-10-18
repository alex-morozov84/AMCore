import type { RequestPrincipal } from '@amcore/shared'

import { memberKeyActor } from '../../src/core/organizations/member-api-keys/member-key-actor'
export function keyTestActor(principal: RequestPrincipal): ReturnType<typeof memberKeyActor> {
  return memberKeyActor({
    user: principal,
    privilegedAdmission: { authenticated: principal, principal },
  })
}
