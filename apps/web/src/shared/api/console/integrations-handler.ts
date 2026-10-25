import {
  AuthErrorCode,
  integrationIdSchema,
  probeAttemptIdSchema,
  probeRequestSchema,
} from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = getBackendBaseUrl()
const BASE = '/api/v1/admin/integrations'
/** Reads and prepare are quick. */
const READ_TIMEOUT_MS = 5_000
/**
 * The test send waits for the 10 s provider deadline plus bounded Redis steps and the audit write
 * on the server. The storage-setting write budget (10 s) would cut off a near-deadline result, so
 * this one is longer; the browser recovers a lost response with the read-only receipt route.
 */
const PROBE_TIMEOUT_MS = 20_000

type Target =
  | { kind: 'list' }
  | { kind: 'prepare'; id: string }
  | { kind: 'probe'; id: string }
  | { kind: 'receipt'; id: string; attemptId: string }

type Upstream = { path: string; body?: string }

/** Validates identifiers and the body, and builds the one upstream route for a target. */
async function resolveUpstream(request: Request, target: Target): Promise<Upstream | Response> {
  if (target.kind === 'list') return { path: BASE }
  const id = integrationIdSchema.safeParse(target.id)
  if (!id.success)
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid integration identifier' })
  const probe = `${BASE}/${encodeURIComponent(id.data)}/probe`
  if (target.kind === 'prepare') return { path: `${probe}/prepare` }
  if (target.kind === 'receipt') {
    const attempt = probeAttemptIdSchema.safeParse(target.attemptId)
    if (!attempt.success)
      return apiErrorResponse(request, { statusCode: 400, message: 'Invalid attempt identifier' })
    return { path: `${probe}/${encodeURIComponent(attempt.data)}` }
  }
  const parsed = probeRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  return { path: probe, body: JSON.stringify(parsed.data) }
}

/**
 * Fixed same-origin routes. Each forwards to exactly one backend route; ids are checked against
 * their schemas before they are placed in a path, so the browser can never choose an upstream.
 * The browser never sees a token. POST requires a trusted Console origin.
 */
export async function handleConsoleIntegrations(
  request: Request,
  target: Target
): Promise<Response> {
  const mutation = request.method === 'POST'
  if (mutation && !isConsoleRequestOriginTrusted(request))
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  const upstream = await resolveUpstream(request, target)
  if (upstream instanceof Response) return upstream

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  try {
    const response = await fetchBackendResponse(`${API_URL}${upstream.path}`, request.headers, {
      method: mutation ? 'POST' : 'GET',
      body: upstream.body,
      cache: 'no-store',
      headers: forwardRequestHeaders(request.headers, resolved.token),
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(target.kind === 'probe' ? PROBE_TIMEOUT_MS : READ_TIMEOUT_MS),
      ]),
    })
    const headers = forwardResponseHeaders(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return apiErrorResponse(request, { statusCode: 503, message: 'Integrations unavailable' })
  }
}
