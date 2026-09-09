import type { ZodType } from 'zod'

import { parseRetryAfterSeconds } from '../retry-after'

import { type BackendAuthMode } from './auth-header'
import { classifyStatus, classifyThrown } from './classify'
import { generateCorrelationId } from './correlation-id'
import { createDeadlineController, withDeadline } from './deadline'
import { BackendRequestError } from './errors'
import { buildOutboundHeaders } from './outbound-headers'
import { readJsonBody } from './response-body'
import type { DataOutcome, UnavailableReason } from './types'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const DEFAULT_TIMEOUT_MS = 5_000

export interface BackendFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** No default - every call site must state its policy explicitly. See
   *  `auth-header.ts` for what each mode does. */
  auth: BackendAuthMode
  /** An optional caller-owned cancellation signal, composed with the
   *  deadline below: whichever fires first wins, and a caller's own
   *  cancellation is rethrown rather than classified as `'timeout'`. */
  signal?: AbortSignal
  /** Bounds the *entire* call, including header/session resolution - not
   *  only the `fetch()` itself. Default 5s. */
  timeoutMs?: number
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
 * Fetch `apps/api` directly - not through this app's own `/api/*` routes.
 * Never throws for a *known* availability failure (`429`/`5xx`/timeout/
 * network) or a real `404` - both come back as a `DataOutcome`. Throws
 * `BackendRequestError` for a rejected 4xx or a `2xx` payload that fails
 * `schema`, `BackendAuthRequiredError` for `auth: 'required'` with no
 * session, and rethrows anything genuinely unrecognized (including the
 * caller's own `signal` firing) - all of these must reach a real error
 * boundary, never a silent degrade.
 */
export async function fetchBackend<T>(
  path: string,
  schema: ZodType<T>,
  opts: BackendFetchOptions
): Promise<DataOutcome<T>> {
  const correlationId = generateCorrelationId()
  const { signal, isCallerCancelled, cleanup } = createDeadlineController(
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts.signal
  )

  try {
    const response = await performRequest(path, opts, correlationId, signal, isCallerCancelled)
    if (response.kind !== 'response') return response.outcome
    return await parseResponse(response.value, schema, correlationId, isCallerCancelled)
  } finally {
    cleanup()
  }
}

type RequestResult =
  { kind: 'response'; value: Response } | { kind: 'outcome'; outcome: DataOutcome<never> }

async function performRequest(
  path: string,
  opts: BackendFetchOptions,
  correlationId: string,
  signal: AbortSignal,
  isCallerCancelled: () => boolean
): Promise<RequestResult> {
  try {
    const headersResult = await withDeadline(buildOutboundHeaders(correlationId, opts.auth), signal)
    if ('authUnavailable' in headersResult) {
      return { kind: 'outcome', outcome: unavailableOutcome('upstream', correlationId) }
    }

    const response = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: headersResult.headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    })
    return { kind: 'response', value: response }
  } catch (error) {
    if (isCallerCancelled()) throw error
    const reason = classifyThrown(error)
    if (reason === null) throw error
    return { kind: 'outcome', outcome: unavailableOutcome(reason, correlationId) }
  }
}

async function parseResponse<T>(
  response: Response,
  schema: ZodType<T>,
  correlationId: string,
  isCallerCancelled: () => boolean
): Promise<DataOutcome<T>> {
  if (!response.ok) {
    const classified = classifyStatus(response.status)
    if (classified === 'not-found') return { status: 'not-found' }
    if (classified === 'rejected') {
      throw new BackendRequestError('rejected', correlationId, response.status)
    }
    return unavailableOutcome(classified, correlationId, response.headers)
  }

  const bodyResult = await readJsonBody(response, isCallerCancelled)
  if (!bodyResult.ok) {
    return unavailableOutcome(bodyResult.reason, correlationId, response.headers)
  }

  const parsed = schema.safeParse(bodyResult.body)
  if (!parsed.success) {
    throw new BackendRequestError('invalid-payload', correlationId, response.status)
  }
  return { status: 'success', data: parsed.data }
}
