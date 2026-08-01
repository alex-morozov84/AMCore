import axios, { type AxiosError } from 'axios'

import { ClientErrorCode } from './error-codes'
import type { ApiErrorResponse, ValidationError } from './types'

/**
 * Type guard: Check if error is an Axios error
 */
export function isAxiosError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error)
}

/**
 * Type guard: Check if Axios error has API error response
 */
export function isApiError(error: unknown): error is AxiosError<ApiErrorResponse> {
  return axios.isAxiosError(error) && error.response?.data !== undefined
}

/**
 * Type guard: Check if error has validation errors
 */
export function hasValidationErrors(error: unknown): error is AxiosError<ApiErrorResponse> {
  return (
    isApiError(error) &&
    error.response?.data.errors !== undefined &&
    Array.isArray(error.response.data.errors) &&
    error.response.data.errors.length > 0
  )
}

/**
 * Extract validation errors from API error response
 */
export function getValidationErrors(error: unknown): ValidationError[] {
  if (hasValidationErrors(error)) {
    return error.response!.data.errors!
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

  if (isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return ClientErrorCode.TIMEOUT
    if (error.code === 'ERR_NETWORK') return ClientErrorCode.NETWORK_ERROR
  }

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
  if (isApiError(error) && error.response) {
    return error.response.data.message
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
  if (isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}

/**
 * Get error code from API error response
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isApiError(error) && error.response) {
    return error.response.data.errorCode
  }
  return undefined
}

/**
 * Get correlation ID from error (for debugging)
 */
export function getCorrelationId(error: unknown): string | undefined {
  if (isApiError(error) && error.response) {
    return error.response.data.correlationId
  }
  return undefined
}
