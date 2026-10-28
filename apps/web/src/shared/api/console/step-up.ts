import { NextResponse } from 'next/server'
import { AuthErrorCode, mfaStepUpCommandSchema, stepUpSchema } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { readContextJson } from '@/shared/api/bff/context-body-budget'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  completeSourceReauthentication,
  startSourceReauthentication,
} from '@/shared/api/bff/mfa-source-operation'
import { forwardRequestHeaders } from '@/shared/api/bff/proxy-headers'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = getBackendBaseUrl()

function originRejected(request: Request): Response {
  return apiErrorResponse(request, {
    statusCode: 403,
    message: 'Request origin rejected',
    errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
  })
}

/** Completed proofs return 204 without credentials; missing MFA returns a safe source-bound continuation. */
export async function handleConsoleStepUp(request: Request): Promise<Response> {
  if (!isConsoleRequestOriginTrusted(request)) return originRejected(request)

  if (
    new URL(request.url).search ||
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
  )
    return apiErrorResponse(request, { statusCode: 400, message: 'Invalid step-up command' })
  const body = await readContextJson(request.body, 2048).catch(() => null)
  const proof = mfaStepUpCommandSchema.safeParse(body)
  const parsed = stepUpSchema.safeParse(body)
  if (!parsed.success && !proof.success) {
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  }

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure

  if (proof.success) {
    try {
      const result = await completeSourceReauthentication(request, resolved, proof.data)
      return result
        ? NextResponse.json(result, { status: 202 })
        : new Response(null, { status: 204 })
    } catch (error) {
      return sourceFailure(request, error)
    }
  }
  if (!parsed.success) throw new Error('Validated step-up command required')

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetchBackendResponse(
      `${API_URL}/api/v1/auth/step-up`,
      request.headers,
      {
        method: 'POST',
        headers: forwardRequestHeaders(request.headers, resolved.token, resolved.bindingHeaders),
        body: JSON.stringify(parsed.data),
      }
    )
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Step-up temporarily unavailable',
    })
  }

  if (!upstreamResponse.ok) {
    const errorBody: unknown = await upstreamResponse.json().catch(() => null)
    return NextResponse.json(
      errorBody ?? { statusCode: upstreamResponse.status, message: 'Step-up failed' },
      { status: upstreamResponse.status }
    )
  }

  // A missing factor is not completed authentication and must never trigger the mutation retry.
  const result: unknown = await readContextJson(upstreamResponse.body, 16384).catch(() => null)
  if (
    upstreamResponse.status === 202 &&
    result &&
    typeof result === 'object' &&
    'kind' in result &&
    result.kind === 'proof_required'
  ) {
    try {
      return NextResponse.json(await startSourceReauthentication(request, resolved), {
        status: 202,
      })
    } catch (error) {
      return sourceFailure(request, error)
    }
  }
  if (
    upstreamResponse.status !== 200 ||
    !result ||
    typeof result !== 'object' ||
    !('accessToken' in result) ||
    typeof result.accessToken !== 'string' ||
    !result.accessToken
  )
    return apiErrorResponse(request, { statusCode: 503, message: 'Invalid step-up outcome' })
  return new Response(null, { status: 204 })
}

function sourceFailure(request: Request, error: unknown): Response {
  const response = authFailureResponse(request, error)
  if (error instanceof ContextRequestError && error.retryAfterSeconds)
    response.headers.set('retry-after', String(error.retryAfterSeconds))
  return response
}
