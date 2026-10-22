import { scheduledJobIdSchema } from '@amcore/shared'

import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const TIMEOUT_MS = 4_000
const BASE = '/api/v1/admin/background-work/scheduled-jobs'

/**
 * Fixed same-origin reads for the live Scheduled jobs refresh and the per-job history. Each forwards
 * to exactly one backend route; a job id is checked against the id schema before it is placed in
 * the path, so the browser can never choose an upstream. The browser never sees a token.
 */
export function handleConsoleScheduledJobs(request: Request): Promise<Response> {
  return read(request, BASE)
}

export function handleConsoleScheduledJobRuns(request: Request, jobId: string): Promise<Response> {
  const id = scheduledJobIdSchema.safeParse(jobId)
  if (!id.success)
    return Promise.resolve(
      apiErrorResponse(request, { statusCode: 400, message: 'Invalid job identifier' })
    )
  return read(request, `${BASE}/${encodeURIComponent(id.data)}/runs`)
}

async function read(request: Request, path: string): Promise<Response> {
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: forwardRequestHeaders(
        request.headers,
        resolved.token,
        resolveTrustedClientIp(request.headers)
      ),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    const headers = forwardResponseHeaders(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return apiErrorResponse(request, { statusCode: 503, message: 'Scheduled jobs unavailable' })
  }
}
