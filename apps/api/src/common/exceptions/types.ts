/**
 * Unified error response shape for all exception filters.
 * Each filter fills only the fields it uses.
 */
export interface ErrorResponse {
  statusCode: number
  message: string
  errorCode?: string
  timestamp: string
  path: string
  method: string
  correlationId?: string
  stack?: string
  details?: Record<string, unknown>
}
