import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions/index.js'
import { apiKeyAdmission, type ApiKeyEvidence } from '../../api-keys/api-key-admission.js'
import type { PrivilegedAdmission } from '../../auth/privileged-admission.service.js'

export interface MemberKeyActor {
  readonly principal: Readonly<RequestPrincipal>
  readonly admission: PrivilegedAdmission
  readonly key?: ApiKeyEvidence
}
const actors = new WeakSet<object>()
export function memberKeyActor(request: {
  user?: RequestPrincipal
  privilegedAdmission?: PrivilegedAdmission
}): MemberKeyActor {
  const { user, privilegedAdmission: admission } = request
  if (
    !user ||
    !admission ||
    admission.principal !== user ||
    admission.authenticated.sub !== user.sub
  )
    throw new ForbiddenException()
  const actor = Object.freeze({
    principal: Object.freeze({ ...user }),
    admission,
    ...(user.type === 'api_key' && { key: apiKeyAdmission(request, admission.authenticated) }),
  })
  actors.add(actor)
  return actor
}
export function assertMemberKeyActor(actor: MemberKeyActor): void {
  if (!actors.has(actor)) throw new ForbiddenException()
}
export const CurrentMemberKeyActor = createParamDecorator(
  (_unused: unknown, context: ExecutionContext) =>
    memberKeyActor(context.switchToHttp().getRequest())
)
