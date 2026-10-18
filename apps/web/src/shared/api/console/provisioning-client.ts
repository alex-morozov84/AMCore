import {
  productAccessBootstrapSchema,
  provisioningCommandReceiptSchema,
  type ProvisioningCreate,
  provisioningLookupSchema,
  provisioningPolicySchema,
  provisioningProgressSchema,
  provisioningReceiptSchema,
} from '@amcore/shared'
import type { ZodType } from 'zod'

import { parseContextResponse } from '@/shared/api/context-response'
import { apiClient, ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

import 'client-only'

const path = (suffix: string) => getConsolePublicApiPath(`/organization-provisionings${suffix}`)
async function read<T>(
  url: string,
  binding: string,
  schema: ZodType<T>,
  signal: AbortSignal
): Promise<T> {
  return parseContextResponse(
    binding,
    schema,
    await apiClient.get(url, { signal, headers: { 'X-AMCore-Context-Session': binding } })
  )
}
async function write<T>(
  url: string,
  binding: string,
  body: unknown,
  schema: ZodType<T>,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-AMCore-Context-Session': binding },
    body: JSON.stringify(body),
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      data as never,
      parseRetryAfterSeconds(response.headers)
    )
  return parseContextResponse(binding, schema, data)
}
const organization = (orgId: string) =>
  getConsolePublicApiPath(`/organizations/${encodeURIComponent(orgId)}/provisioning`)
export const provisioningClient = {
  session: async (signal: AbortSignal) =>
    productAccessBootstrapSchema.parse(await apiClient.get(path('/session'), { signal })),
  policy: (binding: string, signal: AbortSignal) =>
    read(path('/policy'), binding, provisioningPolicySchema, signal),
  lookup: (binding: string, id: string, signal: AbortSignal) =>
    read(path(`/operations/${id}`), binding, provisioningLookupSchema, signal),
  progress: (binding: string, orgId: string, signal: AbortSignal) =>
    read(organization(orgId), binding, provisioningProgressSchema, signal),
  create: (binding: string, input: ProvisioningCreate, signal: AbortSignal) =>
    write(path(''), binding, input, provisioningReceiptSchema, signal),
  recover: (
    binding: string,
    orgId: string,
    kind: 'reissue' | 'replace-recipient' | 'cancel',
    input: unknown,
    signal: AbortSignal
  ) =>
    write(
      `${organization(orgId)}/${kind}`,
      binding,
      input,
      provisioningCommandReceiptSchema,
      signal
    ),
}

export { read as readConsoleOrganization, write as writeConsoleOrganization }
