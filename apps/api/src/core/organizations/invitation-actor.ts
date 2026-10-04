import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions'
import { apiKeyAdmission, type ApiKeyEvidence } from '../api-keys/api-key-admission'
import type { PrivilegedAdmission } from '../auth/privileged-admission.service'

export interface InvitationActor {
  readonly principal: Readonly<RequestPrincipal>
  readonly admission: PrivilegedAdmission
  readonly key?: ApiKeyEvidence
}
const registered = new WeakSet<object>()

/** Request-only evidence survives effective-principal cloning in auth admission. */
export function invitationActor(request: {
  user?: RequestPrincipal
  privilegedAdmission?: PrivilegedAdmission
}): InvitationActor {
  const { user, privilegedAdmission: admission } = request
  if (
    !user ||
    !admission ||
    admission.principal !== user ||
    admission.authenticated.sub !== user.sub ||
    admission.authenticated.type !== user.type
  )
    throw new ForbiddenException()
  const actor = Object.freeze({
    principal: Object.freeze({
      ...user,
      scopes: user.scopes && (Object.freeze([...user.scopes]) as unknown as string[]),
    }),
    admission,
    ...(user.type === 'api_key' && { key: apiKeyAdmission(request, admission.authenticated) }),
  })
  registered.add(actor)
  return actor
}

export function assertInvitationActor(actor: InvitationActor): void {
  if (!registered.has(actor)) throw new ForbiddenException('Verified invitation actor required')
}

export const CurrentInvitationActor = createParamDecorator(
  (_: unknown, execution: ExecutionContext): InvitationActor =>
    invitationActor(execution.switchToHttp().getRequest())
)
