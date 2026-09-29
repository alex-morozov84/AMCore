import { applyDecorators, SetMetadata } from '@nestjs/common'
import { ApiBadRequestResponse, ApiHeader, ApiParam } from '@nestjs/swagger'

import type { OrganizationContextFamily } from '@amcore/shared'
import { ORGANIZATION_CONTEXT_ID_PATTERN } from '@amcore/shared'

export type RequestContextPolicyDefinition =
  | { readonly kind: 'personal' | 'discovery' | 'exchange' }
  | {
      readonly kind: 'organization'
      readonly selector: { readonly param: string } | { readonly header: true }
      readonly concealMissing?: boolean
      /** Only existing bound-JWT handlers with a documented platform bypass. */
      readonly legacyPlatformMembershipBypass?: boolean
    }

export const ORGANIZATION_BOUNDARY = Symbol('organization-context-boundary')
export const REQUEST_CONTEXT_POLICY = Symbol('request-context-policy')
export const REQUEST_CONTEXT_POLICY_COUNT = Symbol('request-context-policy-count')

export const OrganizationContextBoundary = (family: OrganizationContextFamily): ClassDecorator =>
  SetMetadata(ORGANIZATION_BOUNDARY, Object.freeze(family))

const policyMetadata =
  (policy: RequestContextPolicyDefinition): MethodDecorator =>
  (_target, _key, descriptor) => {
    const handler = descriptor.value!
    const count = Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY_COUNT, handler) ?? 0
    Reflect.defineMetadata(REQUEST_CONTEXT_POLICY_COUNT, count + 1, handler)
    Reflect.defineMetadata(REQUEST_CONTEXT_POLICY, Object.freeze(policy), handler)
  }

export function RequestContextPolicy(policy: RequestContextPolicyDefinition): MethodDecorator {
  if (policy.kind !== 'organization') return policyMetadata(policy)
  return applyDecorators(
    policyMetadata(policy),
    ApiHeader({
      name: 'X-AMCore-Organization-ID',
      required: 'header' in policy.selector,
      description:
        'Bounded opaque organization ID. On path-selected operations it must match the authoritative path ID.',
      schema: { type: 'string', pattern: ORGANIZATION_CONTEXT_ID_PATTERN },
    }),
    ApiBadRequestResponse({
      description: 'Invalid or conflicting organization selector or request body',
    }),
    ...('param' in policy.selector
      ? [
          ApiParam({
            name: policy.selector.param,
            type: String,
            description: 'Selected organization ID',
          }),
        ]
      : [])
  )
}
