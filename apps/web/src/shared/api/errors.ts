import axios, { type AxiosError } from 'axios'

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
 * Extract error message from any error type
 */
export function getErrorMessage(error: unknown, fallback = 'Произошла ошибка'): string {
  // Axios error with API response
  if (isApiError(error) && error.response) {
    return error.response.data.message || fallback
  }

  // Axios error without response (network error)
  if (isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return 'Превышено время ожидания'
    if (error.code === 'ERR_NETWORK') return 'Ошибка сети'
    return error.message || fallback
  }

  // Standard Error
  if (error instanceof Error) {
    return error.message
  }

  // Unknown error
  return fallback
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
