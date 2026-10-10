import { adminQueueNameSchema, workJobIdSchema, workListQuerySchema } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/** Reads use the Console vault; this fixed discovery path never accepts a client upstream URL. */
export async function handleConsoleWorkCatalogue(request: Request): Promise<Response> {
  return read(request, '/works')
}

/** Registered IDs and a closed query schema cannot select an arbitrary upstream. */
export async function handleConsoleWorkJobs(
  request: Request,
  workId: string,
  jobId?: string
): Promise<Response> {
  const id = adminQueueNameSchema.safeParse(workId)
  const target = jobId === undefined ? undefined : workJobIdSchema.safeParse(jobId)
  if (!id.success || (target && !target.success))
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid work identifier' })
  let path = `/works/${encodeURIComponent(id.data)}/jobs`
  if (target?.success) path += `/${encodeURIComponent(target.data)}`
  else {
    const query = workListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!query.success)
      return apiErrorResponse(request, {
        statusCode: 400,
        message: 'Validation failed',
        errors: zodValidationErrors(query.error),
      })
    path += `?${new URLSearchParams(Object.entries(query.data).map(([key, value]) => [key, String(value)]))}`
  }
  return read(request, path)
}

async function read(request: Request, path: string): Promise<Response> {
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  try {
    const upstream = await fetch(`${API_URL}/api/v1/admin/background-work${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: forwardRequestHeaders(
        request.headers,
        resolved.token,
        resolveTrustedClientIp(request.headers)
      ),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    })
    const headers = forwardResponseHeaders(upstream.headers)
    headers.set('Cache-Control', 'private, no-store')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Background work catalogue unavailable',
    })
  }
}
