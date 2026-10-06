import { createInviteSchema, invitationOperationIdSchema, inviteListQuerySchema, inviteListResponseSchema, inviteResponseSchema,
  inviteRoleChoicesQuerySchema, inviteRoleChoicesResponseSchema, isOrganizationContextId,
  managerInviteOperationResponseSchema, reissueInviteSchema, revokeInviteQuerySchema, revokeInviteResponseSchema } from '@amcore/shared'
import type { ZodType } from 'zod'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { type ContextExecutorInput, type ContextOperation, executeContextOperation } from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

const RESPONSE_BYTES = 256 * 1024
const REQUEST_BYTES = 16 * 1024
function base(orgId: string) {
  if (!isOrganizationContextId(orgId)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return `/api/v1/organizations/${orgId}`
}
function invitePath(orgId: string, inviteId?: string) {
  if (inviteId !== undefined && !isOrganizationContextId(inviteId)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return `${base(orgId)}/invites${inviteId === undefined ? '' : `/${inviteId}`}`
}
function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  return result.data
}
function query(value: Record<string, unknown>) {
  return new URLSearchParams(Object.entries(value).filter(([, v]) => v !== undefined && v !== '')
    .map(([key, v]) => [key, String(v)])).toString()
}
function execute<T>(orgId: string, operation: ContextOperation<T>, input: ContextExecutorInput) {
  return executeContextOperation({ ...operation, organizationId: orgId, requestBytes: REQUEST_BYTES,
    responseBytes: RESPONSE_BYTES, timeoutMs: operation.method === 'GET' ? 10000 : 15000 }, input, productContextDeps(input.headers))
}

export function readOrganizationInvitations(orgId: string, raw: unknown, input: ContextExecutorInput) {
  return execute(orgId, { method: 'GET', path: `${invitePath(orgId)}?${query(parse(inviteListQuerySchema, raw))}`,
    schema: inviteListResponseSchema, successStatus: 200 }, input)
}
export function readInvitationRoleChoices(orgId: string, raw: unknown, input: ContextExecutorInput) {
  return execute(orgId, { method: 'GET', path: `${invitePath(orgId)}/role-choices?${query(parse(inviteRoleChoicesQuerySchema, raw))}`,
    schema: inviteRoleChoicesResponseSchema, successStatus: 200 }, input)
}
export function createOrganizationInvitation(orgId: string, raw: unknown, operationId: string, input: ContextExecutorInput) {
  return execute(orgId, { method: 'POST', path: invitePath(orgId), body: parse(createInviteSchema, raw),
    invitationOperationId: parse(invitationOperationIdSchema, operationId), schema: inviteResponseSchema, successStatus: 202 }, input)
}
export function reissueOrganizationInvitation(orgId: string, inviteId: string, raw: unknown, operationId: string, input: ContextExecutorInput) {
  return execute(orgId, { method: 'POST', path: `${invitePath(orgId, inviteId)}/reissue`, body: parse(reissueInviteSchema, raw),
    invitationOperationId: parse(invitationOperationIdSchema, operationId), schema: inviteResponseSchema, successStatus: 202 }, input)
}
export function revokeOrganizationInvitation(orgId: string, inviteId: string, raw: unknown, operationId: string, input: ContextExecutorInput) {
  return execute(orgId, { method: 'DELETE', path: `${invitePath(orgId, inviteId)}?${query(parse(revokeInviteQuerySchema, raw))}`,
    invitationOperationId: parse(invitationOperationIdSchema, operationId), bodyMode: 'empty', acknowledgment: { status: 'revoked' as const },
    schema: revokeInviteResponseSchema, successStatus: 204 }, input)
}
export function readInvitationManagerOperation(orgId: string, operationId: string, input: ContextExecutorInput) {
  return execute(orgId, { method: 'GET', path: `${base(orgId)}/invite-operations/${parse(invitationOperationIdSchema, operationId)}`,
    schema: managerInviteOperationResponseSchema, successStatus: 200 }, input)
}
