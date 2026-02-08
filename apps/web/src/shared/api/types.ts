import type { ApiErrorResponse, ValidationError } from '@amcore/shared'

/**
 * Re-export shared types for use in frontend
 * These types are now defined in @amcore/shared to ensure consistency between frontend and backend
 */
export type { ApiErrorResponse, ValidationError }

/**
 * Typed error for successful response (non-error status codes)
 */
export type ApiSuccess<T> = T

/**
 * Typed error for failed response
 */
export type ApiError = ApiErrorResponse
