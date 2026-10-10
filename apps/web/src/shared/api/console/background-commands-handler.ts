import {
  adminQueueNameSchema,
  AuthErrorCode,
  WORK_COMMAND_INPUT_BYTES,
  workCommandSchema,
  workEvidenceReconciliationSchema,
  workJobIdSchema,
  workReconciliationSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { readContextJson } from '@/shared/api/bff/context-body-budget'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/** Fixed routes, bounded input, one HTTP dispatch. A failed POST is recovered through receipt GET. */
export async function handleConsoleWorkCommand(
  request: Request,
  commandId?: string,
  reconciliation = false
): Promise<Response> {
  const response = await handle(request, commandId, reconciliation)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function handle(
  request: Request,
  commandId: string | undefined,
  reconciliation: boolean
): Promise<Response> {
  const write = commandId === undefined || reconciliation
  if (write && !isConsoleRequestOriginTrusted(request))
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  let input: unknown
  if (commandId !== undefined && !z.uuidv7().safeParse(commandId).success)
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid command ID' })
  try {
    input = write ? await readContextJson(request.body, WORK_COMMAND_INPUT_BYTES) : commandId
  } catch (error) {
    return apiErrorResponse(request, {
      statusCode: error instanceof ContextRequestError ? error.status : 400,
      message: 'Invalid command body',
    })
  }
  const parsed = reconciliation
    ? workReconciliationSchema.safeParse(input)
    : commandId === undefined
      ? workCommandSchema.safeParse(input)
      : z.uuidv7().safeParse(input)
  if (!parsed.success)
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  return forward(
    request,
    `/commands${
      commandId === undefined
        ? ''
        : `/${encodeURIComponent(commandId)}${reconciliation ? '/reconciliation' : ''}`
    }`,
    write ? JSON.stringify(parsed.data) : undefined
  )
}

export async function handleConsoleEvidenceReconciliation(
  request: Request,
  workId: string,
  jobId: string
): Promise<Response> {
  const response = await evidenceReconciliation(request, workId, jobId)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function evidenceReconciliation(
  request: Request,
  workId: string,
  jobId: string
): Promise<Response> {
  if (!isConsoleRequestOriginTrusted(request))
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  if (!adminQueueNameSchema.safeParse(workId).success || !workJobIdSchema.safeParse(jobId).success)
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid evidence identity' })
  let input: unknown
  try {
    input = await readContextJson(request.body, WORK_COMMAND_INPUT_BYTES)
  } catch (error) {
    return apiErrorResponse(request, {
      statusCode: error instanceof ContextRequestError ? error.status : 400,
      message: 'Invalid reconciliation body',
    })
  }
  const parsed = workEvidenceReconciliationSchema.safeParse(input)
  if (!parsed.success)
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid evidence disposition' })
  return forward(
    request,
    `/works/${encodeURIComponent(workId)}/jobs/${encodeURIComponent(jobId)}/reconciliation`,
    JSON.stringify(parsed.data)
  )
}

async function forward(request: Request, path: string, body?: string): Promise<Response> {
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  try {
    const upstream = await fetch(`${API_URL}/api/v1/admin/background-work${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: forwardRequestHeaders(
        request.headers,
        resolved.token,
        resolveTrustedClientIp(request.headers)
      ),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      ...(body === undefined ? {} : { body }),
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: forwardResponseHeaders(upstream.headers),
    })
  } catch {
    return apiErrorResponse(request, { statusCode: 503, message: 'Command receipt unavailable' })
  }
}
