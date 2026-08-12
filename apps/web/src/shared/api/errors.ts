import { ClientErrorCode } from './error-codes'
import { ApiNetworkError, ApiRequestError } from './http-client'
import type { ValidationError } from './types'

/**
 * Type guard: does this error carry a parsed `ApiErrorResponse` body?
 */
export function isApiError(
  error: unknown
): error is ApiRequestError & { body: NonNullable<ApiRequestError['body']> } {
  return error instanceof ApiRequestError && error.body !== undefined
}

/**
 * Type guard: does this error carry field-level validation errors?
 */
export function hasValidationErrors(
  error: unknown
): error is ApiRequestError & { body: NonNullable<ApiRequestError['body']> } {
  return isApiError(error) && Array.isArray(error.body.errors) && error.body.errors.length > 0
}

/**
 * Extract validation errors from API error response
 */
export function getValidationErrors(error: unknown): ValidationError[] {
  if (hasValidationErrors(error)) {
    return error.body.errors!
  }
  return []
}

/**
 * Reduce any thrown value to a single machine-readable code.
 *
 * This module is the locale-agnostic library layer: it returns **codes, never
 * user-facing prose**. Translation happens in the UI via `useApiError`. The
 * backend's English `message` is developer-facing and deliberately never
 * surfaced to users — showing it is precisely the defect ADR-023 exists to
 * prevent.
 *
 * Falls through to `UNKNOWN_ERROR` rather than inventing a message, so an
 * unmapped failure is visibly generic instead of leaking internals.
 */
export function resolveErrorCode(error: unknown): string {
  const backendCode = getErrorCode(error)
  if (backendCode) return backendCode

  if (error instanceof ApiNetworkError) return ClientErrorCode.NETWORK_ERROR

  return ClientErrorCode.UNKNOWN_ERROR
}

/**
 * The raw backend message, for diagnostics only.
 *
 * Never render this to a user: it is English-only and written for developers.
 * `useApiError` uses it solely for a development-mode console warning when a
 * code has no translation.
 */
export function getDiagnosticMessage(error: unknown): string | undefined {
  if (isApiError(error)) {
    return error.body.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return undefined
}

/**
 * Get HTTP status code from error
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiRequestError) {
    return error.status
  }
  return undefined
}

/**
 * Get error code from API error response
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isApiError(error)) {
    return error.body.errorCode
  }
  return undefined
}

/**
 * Get correlation ID from error (for debugging)
 */
export function getCorrelationId(error: unknown): string | undefined {
  if (isApiError(error)) {
    return error.body.correlationId
  }
  return undefined
}
