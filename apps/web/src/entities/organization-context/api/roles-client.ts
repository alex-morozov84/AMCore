import {
  capabilityCatalogueResponseSchema,
  type CreateRoleDefinition,
  createRoleDefinitionSchema,
  type DeleteRoleDefinition,
  deleteRoleDefinitionResponseSchema,
  deleteRoleDefinitionSchema,
  memberAccessSchema,
  roleDefinitionDetailSchema,
  roleDefinitionListResponseSchema,
  type SaveRoleDefinition,
  saveRoleDefinitionResponseSchema,
  saveRoleDefinitionSchema,
} from '@amcore/shared'
import type { ZodType } from 'zod'

import { parseContextResponse } from '@/shared/api/context-response'
import { apiClient, ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

const base = (orgId: string) => `/product-access/organizations/${encodeURIComponent(orgId)}`
const headers = (binding: string) => ({ 'X-AMCore-Context-Session': binding })

/**
 * A write is acknowledged only by the exact success status; any other 2xx is an invalid
 * acknowledgment and is never treated as a committed result.
 */
async function write<T>(
  binding: string,
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  status: 200 | 201,
  schema: ZodType<T>,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    signal,
    headers: { ...headers(binding), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      payload as never,
      parseRetryAfterSeconds(response.headers)
    )
  if (response.status !== status) throw new Error('INVALID_WRITE_ACKNOWLEDGMENT')
  return parseContextResponse(binding, schema, payload)
}

/** Browser transport for the role-definition operations; it never holds a bearer credential. */
export const rolesClient = {
  async catalogue(binding: string, orgId: string, signal: AbortSignal) {
    return parseContextResponse(
      binding,
      capabilityCatalogueResponseSchema,
      await apiClient.get(`${base(orgId)}/capabilities`, { headers: headers(binding), signal })
    )
  },
  async list(
    binding: string,
    orgId: string,
    query: { page: number; search: string },
    signal: AbortSignal
  ) {
    const q = new URLSearchParams({ page: String(query.page), limit: '20', search: query.search })
    return parseContextResponse(
      binding,
      roleDefinitionListResponseSchema,
      await apiClient.get(`${base(orgId)}/role-definitions?${q}`, {
        headers: headers(binding),
        signal,
      })
    )
  },
  async memberAccess(binding: string, orgId: string, userId: string, signal: AbortSignal) {
    return parseContextResponse(
      binding,
      memberAccessSchema,
      await apiClient.get(
        `/product-access/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/access`,
        {
          headers: headers(binding),
          signal,
        }
      )
    )
  },
  async detail(binding: string, orgId: string, roleId: string, signal: AbortSignal) {
    return parseContextResponse(
      binding,
      roleDefinitionDetailSchema,
      await apiClient.get(`${base(orgId)}/role-definitions/${encodeURIComponent(roleId)}`, {
        headers: headers(binding),
        signal,
      })
    )
  },
  create(binding: string, orgId: string, dto: CreateRoleDefinition, signal: AbortSignal) {
    return write(
      binding,
      `${base(orgId)}/role-definitions`,
      'POST',
      createRoleDefinitionSchema.parse(dto),
      201,
      roleDefinitionDetailSchema,
      signal
    )
  },
  save(
    binding: string,
    orgId: string,
    roleId: string,
    dto: SaveRoleDefinition,
    signal: AbortSignal
  ) {
    return write(
      binding,
      `${base(orgId)}/role-definitions/${encodeURIComponent(roleId)}`,
      'PATCH',
      saveRoleDefinitionSchema.parse(dto),
      200,
      saveRoleDefinitionResponseSchema,
      signal
    )
  },
  remove(
    binding: string,
    orgId: string,
    roleId: string,
    dto: DeleteRoleDefinition,
    signal: AbortSignal
  ) {
    return write(
      binding,
      `${base(orgId)}/role-definitions/${encodeURIComponent(roleId)}/deletion`,
      'POST',
      deleteRoleDefinitionSchema.parse(dto),
      200,
      deleteRoleDefinitionResponseSchema,
      signal
    )
  },
}
