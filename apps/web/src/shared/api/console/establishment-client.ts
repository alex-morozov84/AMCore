import {
  type OrganizationBootstrap,
  organizationBootstrapResultSchema,
  type OrganizationPrepareAccount,
  organizationPreparedAccountSchema,
  organizationSetupAccountSchema,
  organizationSetupStatusSchema,
  productAccessBootstrapSchema,
} from '@amcore/shared'
import type { ZodType } from 'zod'

import { parseContextResponse } from '@/shared/api/context-response'
import { apiClient, ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

import 'client-only'

const path = (suffix: string) => getConsolePublicApiPath(`/organization-establishment/${suffix}`)
async function write<T>(
  suffix: string,
  binding: string,
  input: unknown,
  schema: ZodType<T>,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(`/api${path(suffix)}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-AMCore-Context-Session': binding },
    body: JSON.stringify(input),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      body as never,
      parseRetryAfterSeconds(response.headers)
    )
  if (response.status !== 200) throw new Error('INVALID_UPSTREAM_RESPONSE')
  return parseContextResponse(binding, schema, body)
}
export const establishmentConsoleClient = {
  session: async (signal: AbortSignal) =>
    productAccessBootstrapSchema.parse(await apiClient.get(path('session'), { signal })),
  status: async (binding: string, signal: AbortSignal) =>
    parseContextResponse(
      binding,
      organizationSetupStatusSchema,
      await apiClient.get(path('status'), {
        headers: { 'X-AMCore-Context-Session': binding },
        signal,
      })
    ),
  account: async (binding: string, id: string, signal: AbortSignal) =>
    parseContextResponse(
      binding,
      organizationSetupAccountSchema,
      await apiClient.get(path(`accounts/${encodeURIComponent(id)}/status`), {
        headers: { 'X-AMCore-Context-Session': binding },
        signal,
      })
    ),
  prepare: (binding: string, input: OrganizationPrepareAccount, signal: AbortSignal) =>
    write('accounts/prepare', binding, input, organizationPreparedAccountSchema, signal),
  bootstrap: (binding: string, input: OrganizationBootstrap, signal: AbortSignal) =>
    write('bootstrap', binding, input, organizationBootstrapResultSchema, signal),
}
