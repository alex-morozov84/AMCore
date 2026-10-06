import {
  memberRolesResponseSchema,
  organizationMembersResponseSchema,
  type ReplaceMemberRoles,
  replaceMemberRolesResponseSchema,
  replaceMemberRolesSchema,
} from '@amcore/shared'

import { parseContextResponse } from '@/shared/api/context-response'
import { apiClient, ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

const base = (orgId: string) => `/product-access/organizations/${encodeURIComponent(orgId)}/members`
const headers = (binding: string) => ({ 'X-AMCore-Context-Session': binding })
export const membersClient = {
  async list(
    binding: string,
    orgId: string,
    query: { page: number; search: string },
    signal: AbortSignal
  ) {
    const q = new URLSearchParams({ page: String(query.page), limit: '20', search: query.search })
    return parseContextResponse(
      binding,
      organizationMembersResponseSchema,
      await apiClient.get(`${base(orgId)}?${q}`, { headers: headers(binding), signal })
    )
  },
  async roles(
    binding: string,
    orgId: string,
    userId: string,
    query: { page: number; search: string; section: 'available' | 'assigned' },
    signal: AbortSignal
  ) {
    const q = new URLSearchParams({
      section: query.section,
      search: query.search,
      page: String(query.page),
      limit: '20',
    })
    return parseContextResponse(
      binding,
      memberRolesResponseSchema,
      await apiClient.get(`${base(orgId)}/${encodeURIComponent(userId)}/roles?${q}`, {
        headers: headers(binding),
        signal,
      })
    )
  },
  async save(
    binding: string,
    orgId: string,
    userId: string,
    dto: ReplaceMemberRoles,
    signal: AbortSignal
  ) {
    const response = await fetch(`/api${base(orgId)}/${encodeURIComponent(userId)}/roles`, {
      method: 'PATCH',
      signal,
      headers: { ...headers(binding), 'Content-Type': 'application/json' },
      body: JSON.stringify(replaceMemberRolesSchema.parse(dto)),
    })
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok)
      throw new ApiRequestError(
        response.status,
        body as never,
        parseRetryAfterSeconds(response.headers)
      )
    if (response.status !== 200) throw new Error('INVALID_WRITE_ACKNOWLEDGMENT')
    return parseContextResponse(binding, replaceMemberRolesResponseSchema, body)
  },
}
