// API public API
export { authApi } from './auth-api'
// `consoleApi` (./console-api.ts) is deliberately not re-exported here: this
// barrel is a universal module reachable regardless of console
// enabled/disabled, and re-exporting a console-only module from it would
// keep that module "reachable" even with the console feature removed.
// Import it directly (`@/shared/api/console-api`), the same way console-only
// `shared/lib` modules are imported directly rather than through a barrel.
export { apiClient, ApiNetworkError, ApiRequestError } from './http-client'
export { getQueryClient } from './query-client'
export { QueryProvider } from './QueryProvider'

// Error handling
export { ClientErrorCode, type ClientErrorCodeValue } from './error-codes'
export * from './errors'
export type * from './types'
export { type ApiErrorView, useApiError } from './use-api-error'
