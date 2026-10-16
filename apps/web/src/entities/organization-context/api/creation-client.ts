import {
  organizationCreationPolicySchema,
  type OrganizationCreationRequest,
  organizationCreationResultSchema,
  orgResponseSchema,
} from '@amcore/shared'

import { parseContextResponse } from '@/shared/api/context-response'
import { apiClient, ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

const headers = (binding: string) => ({ 'X-AMCore-Context-Session': binding })
export const organizationCreationClient = {
  policy: async (binding: string, signal: AbortSignal) =>
    parseContextResponse(
      binding,
      organizationCreationPolicySchema,
      await apiClient.get('/product-access/organizations/creation-policy', {
        headers: headers(binding),
        signal,
      })
    ),
  create: async (input: OrganizationCreationRequest, binding: string, signal: AbortSignal) => {
    const response = await fetch('/api/product-access/organizations', {
      method: 'POST',
      signal,
      headers: { ...headers(binding), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok)
      throw new ApiRequestError(
        response.status,
        body as never,
        parseRetryAfterSeconds(response.headers)
      )
    if (response.status !== 201) throw new Error('INVALID_UPSTREAM_RESPONSE')
    return parseContextResponse(binding, orgResponseSchema, body)
  },
  result: async (operationId: string, binding: string, signal: AbortSignal) =>
    parseContextResponse(
      binding,
      organizationCreationResultSchema,
      await apiClient.get(
        `/product-access/organizations/creation-results/${encodeURIComponent(operationId)}`,
        { headers: headers(binding), signal }
      )
    ),
}
