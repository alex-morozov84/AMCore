import { AuthErrorCode, updateUserSystemRoleSchema } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

function originRejected(request: Request): Response {
  return apiErrorResponse(request, {
    statusCode: 403,
    message: 'Request origin rejected',
    errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
  })
}

/**
 * Console role-change mutation. A **fixed** public route — `userId` comes
 * from this Route Handler's own dynamic
 * segment, the backend target is always `admin/users/:id`, never a
 * client-supplied path. The request body is validated against the same
 * shared `updateUserSystemRoleSchema` the backend DTO uses before it is
 * ever forwarded. The success body (`AdminUserResponse`) carries no
 * credential, so — unlike step-up — it is safe to stream back verbatim.
 */
export async function handleConsoleUserRoleUpdate(
  request: Request,
  userId: string
): Promise<Response> {
  if (!isConsoleRequestOriginTrusted(request)) return originRejected(request)

  const parsed = updateUserSystemRoleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  }

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure

  const trustedClientIp = resolveTrustedClientIp(request.headers)
  const upstreamResponse = await fetch(
    `${API_URL}/api/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: forwardRequestHeaders(request.headers, resolved.token, trustedClientIp),
      body: JSON.stringify(parsed.data),
    }
  )

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}
