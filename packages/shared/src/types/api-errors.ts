/**
 * Validation error for a specific field
 * Used in API responses to provide detailed validation feedback
 */
export interface ValidationError {
  /** Field name/path that failed validation */
  field: string
  /** Error message (localized on frontend) */
  message: string
  /** Zod error code for translation mapping (e.g., 'invalid_type', 'too_small') */
  code?: string
}

/**
 * Standard API error response format
 * Based on RFC 9457 Problem Details (partial implementation)
 */
export interface ApiErrorResponse {
  /** HTTP status code */
  statusCode: number
  /** Human-readable error message */
  message: string
  /** Application-specific error code */
  errorCode?: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Request path */
  path: string
  /** HTTP method */
  method: string
  /** Correlation ID for distributed tracing */
  correlationId?: string
  /** Stack trace (development only) */
  stack?: string
  /** Additional error context */
  details?: Record<string, unknown>
  /** Field-level validation errors */
  errors?: ValidationError[]
}
