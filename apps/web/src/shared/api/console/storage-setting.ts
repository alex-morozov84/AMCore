import { AuthErrorCode, storageProbeSettingUpdateSchema } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

export async function handleConsoleStorageSetting(request: Request): Promise<Response> {
  const mutation = request.method === 'PATCH'
  if (mutation && !isConsoleRequestOriginTrusted(request))
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  let body: string | undefined
  if (mutation) {
    const parsed = storageProbeSettingUpdateSchema.safeParse(await request.json().catch(() => null))
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
  try {
    const response = await fetch(`${API_URL}/api/v1/admin/runtime-settings/storage-probe`, {
      method: mutation ? 'PATCH' : 'GET',
      body,
      cache: 'no-store',
      headers: forwardRequestHeaders(
        request.headers,
        resolved.token,
        resolveTrustedClientIp(request.headers)
      ),
      signal: AbortSignal.timeout(10_000),
    })
    const headers = forwardResponseHeaders(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return apiErrorResponse(request, { statusCode: 503, message: 'Setting request unavailable' })
  }
}
