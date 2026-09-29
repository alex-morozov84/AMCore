import { adminApiKeyRevokeSchema, AuthErrorCode } from '@amcore/shared'
import { z } from 'zod'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

export async function handleConsoleApiKeyRevoke(request: Request, id?: string) {
  const response = await revoke(request, id)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function revoke(request: Request, id?: string) {
  if (!isConsoleRequestOriginTrusted(request))
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  const parsed =
    id !== undefined
      ? z.cuid().safeParse(id)
      : adminApiKeyRevokeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  try {
    const upstream = await fetch(
      `${API_URL}/api/v1/admin/api-keys/${id !== undefined ? encodeURIComponent(id) : 'revoke'}`,
      {
        method: id !== undefined ? 'DELETE' : 'POST',
        cache: 'no-store',
        headers: forwardRequestHeaders(
          request.headers,
          resolved.token,
          resolveTrustedClientIp(request.headers)
        ),
        ...(id === undefined ? { body: JSON.stringify(parsed.data) } : {}),
      }
    )
    const headers = forwardResponseHeaders(upstream.headers)
    headers.set('Cache-Control', 'private, no-store')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return apiErrorResponse(request, { statusCode: 503, message: 'Key revocation unavailable' })
  }
}
