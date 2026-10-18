import {
  administratorAssignmentReceiptSchema,
  administratorAssignmentSchema,
  administratorAttentionQuerySchema,
  administratorAttentionSchema,
  administratorCommandReceiptSchema,
  administratorInvitationCancelSchema,
  administratorInvitationCreateSchema,
  administratorInvitationProgressSchema,
  administratorInvitationReissueSchema,
  administratorInvitationReplaceSchema,
  administratorOperationSchema,
  administratorSummaryQuerySchema,
  administratorSummarySchema,
  invitationOperationIdSchema,
  isOrganizationContextId,
} from '@amcore/shared'
import { z, type ZodType } from 'zod'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { executeContextOperation } from '@/shared/api/bff/context-executor'
import { contextRoute } from '@/shared/api/bff/context-route'
import { contextRouteInput } from '@/shared/api/bff/context-route-input'

import { establishmentConsoleDeps } from './establishment-deps'
import { writeConsoleOrganizationCommand } from './organization-provisioning'

import 'server-only'

function invalid(): never {
  throw new ContextRequestError(400, 'BAD_REQUEST')
}
function read(request: Request, path: string, schema: ZodType, query?: ZodType) {
  return contextRoute(request, () => {
    if (request.body || request.headers.has('content-encoding')) invalid()
    const params = new URL(request.url).searchParams
    if (new Set(params.keys()).size !== [...params.keys()].length) invalid()
    const parsed = query?.safeParse(Object.fromEntries(params))
    if (query ? !parsed?.success : !!params.size) invalid()
    const suffix = parsed?.success
      ? `?${new URLSearchParams(Object.entries(parsed.data as Record<string, unknown>).map(([k, v]) => [k, String(v)]))}`
      : ''
    return executeContextOperation(
      {
        method: 'GET',
        path: `/api/v1/admin/organizations/${path}${suffix}`,
        schema,
        responseBytes: 131072,
        successStatus: 200,
      },
      contextRouteInput(request),
      establishmentConsoleDeps(request.headers)
    )
  })
}
export function administratorAttention(request: Request) {
  return read(request, 'attention', administratorAttentionSchema, administratorAttentionQuerySchema)
}
export function administratorOrganization(request: Request, orgId: string, parts: string[] = []) {
  if (!isOrganizationContextId(orgId)) return contextRoute(request, invalid)
  const root = `${encodeURIComponent(orgId)}/`
  if (request.method === 'GET' && parts.length === 0)
    return read(
      request,
      `${root}administration`,
      administratorSummarySchema,
      administratorSummaryQuerySchema
    )
  if (
    request.method === 'GET' &&
    parts.length === 2 &&
    parts[0] === 'operations' &&
    invitationOperationIdSchema.safeParse(parts[1]).success
  )
    return read(
      request,
      `${root}administrator-operations/${parts[1]}`,
      administratorOperationSchema
    )
  if (
    request.method === 'GET' &&
    parts.length === 2 &&
    parts[0] === 'invitations' &&
    invitationOperationIdSchema.safeParse(parts[1]).success
  )
    return read(
      request,
      `${root}administrator-invitations/${parts[1]}`,
      administratorInvitationProgressSchema
    )
  const write = (
    path: string,
    input: ZodType,
    schema = administratorCommandReceiptSchema,
    status: 200 | 201 = 200
  ) =>
    writeConsoleOrganizationCommand(request, `organizations/${root}${path}`, input, schema, status)
  if (request.method === 'POST' && parts.length === 1 && parts[0] === 'invitations')
    return writeConsoleOrganizationCommand(
      request,
      `organizations/${root}administrator-invitations`,
      administratorInvitationCreateSchema,
      administratorCommandReceiptSchema,
      201,
      {
        code: 'ADMIN_INVITATION_ALREADY_PENDING',
        schema: z.strictObject({
          supersedesInvite: z.strictObject({
            id: z.string().min(1).max(128),
            generation: z.number().int().positive().max(2147483647),
          }),
        }),
      }
    )
  if (request.method === 'POST' && parts.length === 1 && parts[0] === 'assign')
    return writeConsoleOrganizationCommand(
      request,
      `organizations/${root}administrators`,
      administratorAssignmentSchema,
      administratorAssignmentReceiptSchema
    )
  if (
    request.method === 'POST' &&
    parts.length === 3 &&
    parts[0] === 'invitations' &&
    invitationOperationIdSchema.safeParse(parts[1]).success
  ) {
    const input =
      parts[2] === 'reissue'
        ? administratorInvitationReissueSchema
        : parts[2] === 'replace-recipient'
          ? administratorInvitationReplaceSchema
          : parts[2] === 'cancel'
            ? administratorInvitationCancelSchema
            : undefined
    if (input) return write(`administrator-invitations/${parts[1]}/${parts[2]}`, input)
  }
  return contextRoute(request, invalid)
}
