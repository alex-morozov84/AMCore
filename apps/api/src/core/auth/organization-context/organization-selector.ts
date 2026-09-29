import type { Request } from 'express'

import { isOrganizationContextId } from '@amcore/shared'

import { BadRequestException } from '../../../common/exceptions'

import type { RequestContextPolicyDefinition } from './request-context-policy'

export const ORGANIZATION_HEADER = 'x-amcore-organization-id'

export function organizationHeader(request: Request): string | undefined {
  const occurrences = (request.rawHeaders ?? []).filter(
    (value, index) => index % 2 === 0 && value.toLowerCase() === ORGANIZATION_HEADER
  ).length
  const value = request.headers[ORGANIZATION_HEADER]
  if (occurrences > 1 || (value !== undefined && !isOrganizationContextId(value))) {
    throw new BadRequestException('Invalid organization selector')
  }
  return value
}

export function organizationSelector(
  request: Request,
  policy: Extract<RequestContextPolicyDefinition, { kind: 'organization' }>,
  header: string | undefined
): string {
  const id = 'param' in policy.selector ? request.params[policy.selector.param] : header
  if (!isOrganizationContextId(id)) {
    throw new BadRequestException('Missing or invalid organization selector')
  }
  if (header !== undefined && header !== id) {
    throw new BadRequestException('Conflicting organization selectors')
  }
  return id
}
