import type { OrganizationContextFamily } from '../types/organization-context'

export const ORGANIZATION_CONTEXT_ID_PATTERN = '^[A-Za-z0-9_-]{1,128}$'
const organizationContextId = new RegExp(ORGANIZATION_CONTEXT_ID_PATTERN)
export const isOrganizationContextId = (value: unknown): value is string =>
  typeof value === 'string' && organizationContextId.test(value)

export const ORGANIZATION_CONTEXT_FAMILY: OrganizationContextFamily = Object.freeze({
  apiRoots: Object.freeze(['/api/v1/organizations', '/api/v1/product-access']),
})
