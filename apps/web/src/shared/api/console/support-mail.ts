import {
  adminDetailIdSchema,
  AuthErrorCode,
  supportMailAttemptIdSchema,
  supportMailPrepareSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { readContextJson } from '@/shared/api/bff/context-body-budget'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = getBackendBaseUrl()
type Operation = 'status' | 'prepare' | 'send' | 'receipt'
/** Every operation selects its own fixed upstream. A browser supplies no URL or recipient. */
export async function handleSupportMail(
  request: Request,
  userId: string,
  operation: Operation,
  attemptId?: string
): Promise<Response> {
  const mutation = operation === 'prepare' || operation === 'send'
  if (mutation && !isConsoleRequestOriginTrusted(request))
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  if (
    !adminDetailIdSchema.safeParse(userId).success ||
    ((operation === 'send' || operation === 'receipt') &&
      !supportMailAttemptIdSchema.safeParse(attemptId).success)
  )
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid path' })
  let body: string | undefined
  if (mutation) {
    let value: unknown
    try {
      value = await readContextJson(request.body, 8192)
    } catch (error) {
      return apiErrorResponse(request, {
        statusCode: error instanceof ContextRequestError ? error.status : 400,
        message: 'Invalid body',
      })
    }
    const parsed = (
      operation === 'prepare' ? supportMailPrepareSchema : z.strictObject({})
    ).safeParse(value)
    if (!parsed.success)
      return apiErrorResponse(request, {
        statusCode: 400,
        message: 'Validation failed',
        errors: zodValidationErrors(parsed.error),
      })
    body = JSON.stringify(parsed.data)
  }
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  const suffix =
    operation === 'status'
      ? ''
      : operation === 'prepare'
        ? '/prepare'
        : `/${encodeURIComponent(attemptId!)}${operation === 'send' ? '/send' : ''}`
  try {
    const response = await fetchBackendResponse(
      `${API_URL}/api/v1/admin/users/${encodeURIComponent(userId)}/support-mail${suffix}`,
      request.headers,
      {
        method: mutation ? 'POST' : 'GET',
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(operation === 'send' ? 25_000 : 5000),
        headers: forwardRequestHeaders(request.headers, resolved.token),
      }
    )
    const headers = forwardResponseHeaders(response.headers)
    headers.set('Cache-Control', 'private, no-store')
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Mail request could not be confirmed',
    })
  }
}
