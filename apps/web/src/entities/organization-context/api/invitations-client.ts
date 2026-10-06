import {
  type CreateInviteInput,
  createInviteSchema,
  invitationOperationIdSchema,
  inviteListQuerySchema,
  inviteListResponseSchema,
  inviteResponseSchema,
  inviteRoleChoicesQuerySchema,
  inviteRoleChoicesResponseSchema,
  managerInviteOperationResponseSchema,
  type ReissueInviteInput,
  reissueInviteSchema,
  revokeInviteQuerySchema,
  revokeInviteResponseSchema,
} from '@amcore/shared'
import type { ZodType } from 'zod'

import { parseContextResponse } from '@/shared/api/context-response'
import { apiClient, ApiRequestError } from '@/shared/api/http-client'
import { parseRetryAfterSeconds } from '@/shared/api/retry-after'

import 'client-only'

const base = (id: string) => `/product-access/organizations/${encodeURIComponent(id)}`
const headers = (binding: string) => ({ 'X-AMCore-Context-Session': binding })
function query(value: Record<string, unknown>) {
  return new URLSearchParams(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  ).toString()
}
async function read<T>(binding: string, path: string, schema: ZodType<T>, signal: AbortSignal) {
  return parseContextResponse(
    binding,
    schema,
    await apiClient.get(path, { headers: headers(binding), signal })
  )
}
async function write<T>(
  binding: string,
  path: string,
  operationId: string,
  method: 'POST' | 'DELETE',
  body: unknown,
  status: 200 | 202,
  schema: ZodType<T>,
  signal: AbortSignal
) {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      ...headers(binding),
      'X-Invitation-Operation-Id': invitationOperationIdSchema.parse(operationId),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      value as never,
      parseRetryAfterSeconds(response.headers)
    )
  if (response.status !== status) throw new Error('INVALID_WRITE_ACKNOWLEDGMENT')
  return parseContextResponse(binding, schema, value)
}

/** Typed headless operations; navigation, drafts and operation journals belong to their own owners. */
export const invitationsClient = {
  list(binding: string, id: string, input: unknown, signal: AbortSignal) {
    return read(
      binding,
      `${base(id)}/invites?${query(inviteListQuerySchema.parse(input))}`,
      inviteListResponseSchema,
      signal
    )
  },
  roles(binding: string, id: string, input: unknown, signal: AbortSignal) {
    return read(
      binding,
      `${base(id)}/invites/role-choices?${query(inviteRoleChoicesQuerySchema.parse(input))}`,
      inviteRoleChoicesResponseSchema,
      signal
    )
  },
  create(
    binding: string,
    id: string,
    operationId: string,
    input: CreateInviteInput,
    signal: AbortSignal
  ) {
    return write(
      binding,
      `${base(id)}/invites`,
      operationId,
      'POST',
      createInviteSchema.parse(input),
      202,
      inviteResponseSchema,
      signal
    )
  },
  reissue(
    binding: string,
    id: string,
    inviteId: string,
    operationId: string,
    input: ReissueInviteInput,
    signal: AbortSignal
  ) {
    return write(
      binding,
      `${base(id)}/invites/${encodeURIComponent(inviteId)}/reissue`,
      operationId,
      'POST',
      reissueInviteSchema.parse(input),
      202,
      inviteResponseSchema,
      signal
    )
  },
  revoke(
    binding: string,
    id: string,
    inviteId: string,
    operationId: string,
    generation: number,
    signal: AbortSignal
  ) {
    return write(
      binding,
      `${base(id)}/invites/${encodeURIComponent(inviteId)}?${query(revokeInviteQuerySchema.parse({ expectedGeneration: generation }))}`,
      operationId,
      'DELETE',
      undefined,
      200,
      revokeInviteResponseSchema,
      signal
    )
  },
  receipt(binding: string, id: string, operationId: string, signal: AbortSignal) {
    return read(
      binding,
      `${base(id)}/invite-operations/${invitationOperationIdSchema.parse(operationId)}`,
      managerInviteOperationResponseSchema,
      signal
    )
  },
}
