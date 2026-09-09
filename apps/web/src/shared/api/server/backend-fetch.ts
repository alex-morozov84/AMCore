import { headers as nextHeaders } from 'next/headers'
import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'
import type { ZodType } from 'zod'

import { resolveTrustedClientIp } from '../bff/trusted-client-ip'
import { parseRetryAfterSeconds } from '../retry-after'

import { getBackendAccessToken } from './access-token'
import { classifyStatus, classifyThrown } from './classify'
import { generateCorrelationId } from './correlation-id'
import { BackendRequestError } from './errors'
import type { DataOutcome, UnavailableReason } from './types'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const DEFAULT_TIMEOUT_MS = 5_000

export interface BackendFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Default 5s — bounded per `ai/models-talk.md`'s zero-automatic-retry,
   *  always-bounded design; raise per call for a known-slower endpoint. */
  timeoutMs?: number
}

/**
 * Outbound headers for a direct `apps/api` call: never the inbound request's
 * own headers verbatim (matches `bff/proxy-headers.ts`'s allowlist
 * discipline for the browser-proxy path) — only the specific, deliberate
 * set this transport is allowed to add.
 */
async function buildOutboundHeaders(correlationId: string): Promise<Headers> {
  const inbound = await nextHeaders()
  const trustedIp = resolveTrustedClientIp(inbound)
  const accessToken = await getBackendAccessToken()

  const outbound = new Headers({
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
  })
  if (accessToken) outbound.set('Authorization', `Bearer ${accessToken}`)
  if (trustedIp) outbound.set(AMCORE_CLIENT_IP_HEADER, trustedIp)
  return outbound
}

function unavailableOutcome(
  reason: UnavailableReason,
  correlationId: string,
  responseHeaders?: Headers
): DataOutcome<never> {
  const retryAfterSeconds = responseHeaders ? parseRetryAfterSeconds(responseHeaders) : undefined
  return {
    status: 'unavailable',
    reason,
    retryAfterMs: retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : undefined,
    correlationId,
  }
}

/**
 * Fetch `apps/api` directly — not through this app's own `/api/*` routes.
 * The installed Next docs are explicit that Server Components should fetch
 * from the source directly (`node_modules/next/dist/docs/01-app/02-guides/
 * backend-for-frontend.md` → "Caveats" → "Server Components"); see
 * `ai/models-talk.md` §5 for the full reasoning and what this reuses from
 * the BFF proxy's own security posture (session-vault token, trusted-IP
 * relay, correlation id) rather than duplicating it.
 *
 * Never throws for a *known* availability failure (`429`/`5xx`/timeout/
 * network) or a real `404` — both come back as a `DataOutcome`. Throws
 * `BackendRequestError` for a rejected 4xx or a `2xx` payload that fails
 * `schema`, and rethrows anything genuinely unrecognized — both must reach a
 * real error boundary / `onRequestError`, never a silent degrade
 * (`ai/models-talk.md` §3).
 */
export async function fetchBackend<T>(
  path: string,
  schema: ZodType<T>,
  opts: BackendFetchOptions = {}
): Promise<DataOutcome<T>> {
  const correlationId = generateCorrelationId()

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: await buildOutboundHeaders(correlationId),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = classifyThrown(error)
    if (reason === null) throw error
    return unavailableOutcome(reason, correlationId)
  }

  if (!response.ok) {
    const classified = classifyStatus(response.status)
    if (classified === 'not-found') return { status: 'not-found' }
    if (classified === 'rejected') {
      throw new BackendRequestError('rejected', correlationId, response.status)
    }
    return unavailableOutcome(classified, correlationId, response.headers)
  }

  const rawBody = await response.json().catch(() => undefined)
  const parsed = schema.safeParse(rawBody)
  if (!parsed.success) {
    throw new BackendRequestError('invalid-payload', correlationId, response.status)
  }
  return { status: 'success', data: parsed.data }
}
