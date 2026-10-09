import {
  ACCESS_RESPONSE_BYTES,
  CAPABILITY_CATALOGUE_RESPONSE_BYTES,
  capabilityCatalogueResponseSchema,
  createRoleDefinitionSchema,
  deleteRoleDefinitionResponseSchema,
  deleteRoleDefinitionSchema,
  isOrganizationContextId,
  memberAccessSchema,
  ROLE_DETAIL_RESPONSE_BYTES,
  ROLE_LIST_RESPONSE_BYTES,
  ROLE_REQUEST_BYTES,
  roleDefinitionDetailSchema,
  roleDefinitionListQuerySchema,
  roleDefinitionListResponseSchema,
  saveRoleDefinitionResponseSchema,
  saveRoleDefinitionSchema,
} from '@amcore/shared'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  type ContextExecutorInput,
  executeContextOperation,
} from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

function base(orgId: string, ...rest: string[]) {
  if (!isOrganizationContextId(orgId) || !rest.every(isOrganizationContextId))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return `/api/v1/organizations/${orgId}`
}
function parse<T>(
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
const deps = (input: ContextExecutorInput) => productContextDeps(input.headers)

/** Typed same-origin operations; paths, methods and schemas are code-owned, never browser URLs. */
export async function readCapabilityCatalogue(orgId: string, input: ContextExecutorInput) {
  return executeContextOperation(
    {
      method: 'GET',
      path: `${base(orgId)}/capabilities`,
      organizationId: orgId,
      schema: capabilityCatalogueResponseSchema,
      successStatus: 200,
      responseBytes: CAPABILITY_CATALOGUE_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
/** The server-side explanation of what one member can do in this organization. */
export async function readMemberAccess(orgId: string, userId: string, input: ContextExecutorInput) {
  return executeContextOperation(
    {
      method: 'GET',
      path: `${base(orgId, userId)}/members/${userId}/access`,
      organizationId: orgId,
      schema: memberAccessSchema,
      successStatus: 200,
      responseBytes: ACCESS_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
export async function listRoleDefinitions(
  orgId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const query = parse(roleDefinitionListQuerySchema, raw)
  return executeContextOperation(
    {
      method: 'GET',
      path: `${base(orgId)}/role-definitions?${search(query)}`,
      organizationId: orgId,
      schema: roleDefinitionListResponseSchema,
      successStatus: 200,
      responseBytes: ROLE_LIST_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
export async function readRoleDefinition(
  orgId: string,
  roleId: string,
  input: ContextExecutorInput
) {
  return executeContextOperation(
    {
      method: 'GET',
      path: `${base(orgId, roleId)}/role-definitions/${roleId}`,
      organizationId: orgId,
      schema: roleDefinitionDetailSchema,
      successStatus: 200,
      responseBytes: ROLE_DETAIL_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
export async function createRoleDefinition(
  orgId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const body = parse(createRoleDefinitionSchema, raw)
  return executeContextOperation(
    {
      method: 'POST',
      path: `${base(orgId)}/role-definitions`,
      organizationId: orgId,
      body,
      schema: roleDefinitionDetailSchema,
      requestBytes: ROLE_REQUEST_BYTES,
      successStatus: 201,
      responseBytes: ROLE_DETAIL_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
export async function saveRoleDefinition(
  orgId: string,
  roleId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const body = parse(saveRoleDefinitionSchema, raw)
  return executeContextOperation(
    {
      method: 'PATCH',
      path: `${base(orgId, roleId)}/role-definitions/${roleId}`,
      organizationId: orgId,
      body,
      schema: saveRoleDefinitionResponseSchema,
      requestBytes: ROLE_REQUEST_BYTES,
      successStatus: 200,
      responseBytes: ROLE_DETAIL_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
export async function deleteRoleDefinition(
  orgId: string,
  roleId: string,
  raw: unknown,
  input: ContextExecutorInput
) {
  const body = parse(deleteRoleDefinitionSchema, raw)
  return executeContextOperation(
    {
      method: 'POST',
      path: `${base(orgId, roleId)}/role-definitions/${roleId}/deletion`,
      organizationId: orgId,
      body,
      schema: deleteRoleDefinitionResponseSchema,
      requestBytes: ROLE_REQUEST_BYTES,
      successStatus: 200,
      responseBytes: ROLE_DETAIL_RESPONSE_BYTES,
    },
    input,
    deps(input)
  )
}
