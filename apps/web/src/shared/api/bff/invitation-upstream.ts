import { z } from 'zod'

import { parseRetryAfterSeconds } from '../retry-after'
import { classifyThrown } from '../server/classify'

import { readContextJson } from './context-body-budget'
import { sessionMetadataHeaders } from './session-metadata-headers'
import { extractCookieValue } from './set-cookie'

import 'server-only'

export class InvitationBackendError extends Error {
  constructor(
    readonly status: number,
    readonly knownRejection: boolean,
    readonly errorCode?: string,
    readonly retryAfterSeconds?: number,
    readonly category: 'availability' | 'rejection' | 'contract' = knownRejection
      ? 'rejection'
      : 'availability'
  ) {
    super('Invitation backend request failed')
  }
}

type RequestOptions = {
  source: Headers
  signal: AbortSignal
  method: 'GET' | 'POST' | 'DELETE'
  expectedStatus: 200 | 201
  body?: unknown
  credential?: string
  accessToken?: string
  refreshToken?: string
  operationId?: string
  handoff?: { attemptId: string; cleanupKey: string }
}

/** Code-owned direct API transport; never copies browser authority/proof headers or upstream bodies into errors. */
async function fetchInvitationResponse(
  path: string,
  options: Omit<RequestOptions, 'expectedStatus'>
): Promise<Response> {
  const headers = new Headers(sessionMetadataHeaders(options.source))
  const language = options.source.get('accept-language')
  if (language) headers.set('accept-language', language)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.credential) headers.set('x-invitation-continuation', options.credential)
  if (options.accessToken) headers.set('authorization', `Bearer ${options.accessToken}`)
  if (options.refreshToken) headers.set('cookie', `refresh_token=${options.refreshToken}`)
  if (options.operationId) headers.set('x-invitation-operation-id', options.operationId)
  if (options.handoff) {
    headers.set('x-invitation-auth-attempt-id', options.handoff.attemptId)
    headers.set('x-invitation-handoff-key', options.handoff.cleanupKey)
  }
  try {
    return await fetch(`${process.env.API_URL ?? 'http://localhost:5002'}/api/v1${path}`, {
      method: options.method,
      headers,
      signal: options.signal,
      redirect: 'error',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (classifyThrown(error)) throw new InvitationBackendError(503, false)
    throw new InvitationBackendError(503, false, undefined, undefined, 'contract')
  }
}

export async function invitationBackend<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions
): Promise<{ data: T; refreshToken: string | null }> {
  const response = await fetchInvitationResponse(path, options)
  const rejected = response.status >= 400 && response.status < 500 && response.status !== 408
  let body: unknown
  try {
    body = await readContextJson(response.body, 256 * 1024)
  } catch (error) {
    const category = classifyThrown(error) || !response.ok ? 'availability' : 'contract'
    throw new InvitationBackendError(
      rejected ? response.status : 503,
      rejected,
      undefined,
      undefined,
      rejected ? 'rejection' : category
    )
  }
  if (!response.ok) {
    const parsed = z
      .object({
        errorCode: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
          .optional(),
      })
      .safeParse(body)
    throw new InvitationBackendError(
      response.status,
      rejected,
      parsed.success ? parsed.data.errorCode : undefined,
      parseRetryAfterSeconds(response.headers)
    )
  }
  const parsed = schema.safeParse(body)
  if (response.status !== options.expectedStatus || !parsed.success)
    throw new InvitationBackendError(503, false, undefined, undefined, 'contract')
  if (options.signal.aborted) throw new InvitationBackendError(503, false)
  return { data: parsed.data, refreshToken: extractCookieValue(response, 'refresh_token') }
}

/** Empty success is a distinct transport mode; never parse a204 as JSON or treat another2xx as revocation. */
export async function invitationBackendNoContent(
  path: string,
  options: Omit<RequestOptions, 'expectedStatus'>
): Promise<void> {
  const response = await fetchInvitationResponse(path, options)
  if (response.status === 204 && response.body === null) {
    if (options.signal.aborted) throw new InvitationBackendError(503, false)
    return
  }
  const rejected = response.status >= 400 && response.status < 500 && response.status !== 408
  throw new InvitationBackendError(rejected ? response.status : 503, rejected)
}
