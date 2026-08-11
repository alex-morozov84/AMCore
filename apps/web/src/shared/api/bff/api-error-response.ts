import { NextResponse } from 'next/server'
import type { ApiErrorResponse, ValidationError } from '@amcore/shared'
import type { ZodError } from 'zod'

/**
 * Maps a Zod issue list to the shared `ValidationError[]` shape — matches
 * `apps/api`'s own `HttpExceptionFilter.extractValidationErrors` output, so
 * a BFF-level validation failure looks identical to a backend one to the
 * frontend (`hasValidationErrors`/`getValidationErrors` in `shared/api/errors.ts`).
 */
export function zodValidationErrors(error: ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

export interface ApiErrorParams {
  statusCode: number
  message: string
  errorCode?: string
  errors?: ValidationError[]
}

/**
 * Builds an `ApiErrorResponse`-shaped JSON response — this is a new public
 * endpoint boundary (Route Handlers under `app/api/`), so it must not
 * introduce a second error contract alongside the backend's own
 * (`apps/api/src/common/exceptions/filters/http-exception.filter.ts`).
 * `errorCode` is intentionally omitted (left `undefined`) for a plain
 * validation failure, matching the backend's own behavior of relying on
 * `errors` rather than inventing a generic top-level code for that case.
 */
export function apiErrorResponse(request: Request, params: ApiErrorParams): NextResponse {
  const body: ApiErrorResponse = {
    statusCode: params.statusCode,
    message: params.message,
    errorCode: params.errorCode,
    timestamp: new Date().toISOString(),
    path: new URL(request.url).pathname,
    method: request.method,
    correlationId: crypto.randomUUID(),
    ...(params.errors ? { errors: params.errors } : {}),
  }

  return NextResponse.json(body, { status: params.statusCode })
}
