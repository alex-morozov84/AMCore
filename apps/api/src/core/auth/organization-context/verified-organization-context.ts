import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { PrivilegedAdmission } from '../privileged-admission.service'

const verified = new WeakMap<object, PrivilegedAdmission>()

/** API-only evidence. Never deserialize this shape from a credential or request body. */
export interface VerifiedOrganizationContext {
  readonly organizationId: string
  readonly aclVersion: number
  readonly actorId: string
  readonly membershipVerified: boolean
}

export function verifiedOrganizationContext(
  context: VerifiedOrganizationContext,
  admission: PrivilegedAdmission
): VerifiedOrganizationContext {
  const frozen = Object.freeze(context)
  verified.set(frozen, admission)
  return frozen
}

export function assertVerifiedContext(
  context: VerifiedOrganizationContext,
  admission: PrivilegedAdmission
): void {
  if (verified.get(context) !== admission) throw new Error('Unverified organization context')
}

export const CurrentOrganizationContext = createParamDecorator(
  (_: unknown, execution: ExecutionContext): VerifiedOrganizationContext => {
    const request = execution.switchToHttp().getRequest<{
      organizationContext?: VerifiedOrganizationContext
      privilegedAdmission?: PrivilegedAdmission
    }>()
    if (!request.organizationContext || !request.privilegedAdmission) {
      throw new Error('Missing verified organization context')
    }
    assertVerifiedContext(request.organizationContext, request.privilegedAdmission)
    return request.organizationContext
  }
)
