import type { ExecutionContext } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'

import {
  ORGANIZATION_BOUNDARY,
  REQUEST_CONTEXT_POLICY,
  REQUEST_CONTEXT_POLICY_COUNT,
  type RequestContextPolicyDefinition,
} from './request-context-policy'

function routePaths(target: Function): string[] {
  const path: string | string[] | undefined = Reflect.getMetadata(PATH_METADATA, target)
  return Array.isArray(path) ? path : [path ?? '']
}

export function contextPolicyMetadata(
  execution: ExecutionContext
): RequestContextPolicyDefinition | undefined {
  const handler = execution.getHandler()
  const boundary = Reflect.getMetadata(ORGANIZATION_BOUNDARY, execution.getClass())
  const policy = Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY, handler) as
    RequestContextPolicyDefinition | undefined
  const count = Reflect.getOwnMetadata(REQUEST_CONTEXT_POLICY_COUNT, handler)
  if (
    (boundary && !policy) ||
    (policy && (!boundary || count !== 1)) ||
    (policy && !['personal', 'discovery', 'exchange', 'organization'].includes(policy.kind))
  ) {
    throw new Error('Invalid organization context policy boundary')
  }
  if (policy?.kind === 'organization') validateSelector(execution, policy)
  return policy
}

function validateSelector(
  execution: ExecutionContext,
  policy: Extract<RequestContextPolicyDefinition, { kind: 'organization' }>
): void {
  const selector = policy.selector
  if (
    !selector ||
    'param' in selector === 'header' in selector ||
    ('header' in selector && selector.header !== true)
  ) {
    throw new Error('Invalid organization selector policy')
  }
  if ('param' in selector) {
    const declared = routePaths(execution.getClass()).flatMap((prefix) =>
      routePaths(execution.getHandler()).map((suffix) => `${prefix}/${suffix}`)
    )
    if (
      !selector.param ||
      declared.some((path) => !path.split('/').includes(`:${selector.param}`))
    ) {
      throw new Error('Unresolvable organization selector policy')
    }
  }
}
