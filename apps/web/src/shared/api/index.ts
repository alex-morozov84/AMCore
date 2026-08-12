// API public API
export { authApi } from './auth-api'
export { apiClient, ApiNetworkError, ApiRequestError } from './http-client'
export { getQueryClient } from './query-client'
export { QueryProvider } from './QueryProvider'

// Error handling
export { ClientErrorCode, type ClientErrorCodeValue } from './error-codes'
export * from './errors'
export type * from './types'
export { type ApiErrorView, useApiError } from './use-api-error'
