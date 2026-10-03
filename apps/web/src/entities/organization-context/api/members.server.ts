import {
  isOrganizationContextId,
  MEMBER_REQUEST_BYTES,
  MEMBER_RESPONSE_BYTES,
  memberRolesQuerySchema,
  memberRolesResponseSchema,
  organizationMembersQuerySchema,
  organizationMembersResponseSchema,
  replaceMemberRolesResponseSchema,
  replaceMemberRolesSchema,
} from '@amcore/shared'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

function path(orgId: string, userId?: string) {
  if (!isOrganizationContextId(orgId) || (userId !== undefined && !isOrganizationContextId(userId)))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return `/api/v1/organizations/${orgId}/members${userId === undefined ? '' : `/${userId}/roles`}`
}
function query<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  value: unknown
): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  return result.data!
}
function search(value: Record<string, unknown>) {
  return new URLSearchParams(
    Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)])
  ).toString()
}
export function readOrganizationMembers(orgId: string, raw: unknown, input: ContextExecutorInput) {
  const q = query(organizationMembersQuerySchema, raw)
  return executeContextOperation(
    {
      method: 'GET',
      path: `${path(orgId)}?${search(q)}`,
      organizationId: orgId,
      schema: organizationMembersResponseSchema,
      successStatus: 200,
      responseBytes: MEMBER_RESPONSE_BYTES,
    },
    input,
    productContextDeps(input.headers)
  )
}
export function readMemberRoles(
  orgId: string,
  userId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const q = query(memberRolesQuerySchema, raw)
  return executeContextOperation(
    {
      method: 'GET',
      path: `${path(orgId, userId)}?${search(q)}`,
      organizationId: orgId,
      schema: memberRolesResponseSchema,
      successStatus: 200,
      responseBytes: MEMBER_RESPONSE_BYTES,
    },
    input,
    productContextDeps(input.headers)
  )
}
export function replaceMemberRoles(
  orgId: string,
  userId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const body = query(replaceMemberRolesSchema, raw)
  return executeContextOperation(
    {
      method: 'PATCH',
      path: path(orgId, userId),
      organizationId: orgId,
      body,
      schema: replaceMemberRolesResponseSchema,
      requestBytes: MEMBER_REQUEST_BYTES,
      successStatus: 200,
      responseBytes: MEMBER_RESPONSE_BYTES,
    },
    input,
    productContextDeps(input.headers)
  )
}
