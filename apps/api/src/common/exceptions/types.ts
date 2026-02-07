/**
 * Validation error detail (for field-level validation errors)
 */
export interface ValidationError {
  /** Field path (e.g., "email", "password", "profile.name") */
  field: string
  /** Human-readable error message */
  message: string
  /** Error code from validator (e.g., "too_small", "invalid_email") - optional */
  code?: string
}

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
  /** Field-level validation errors (for 400 validation failures) */
  errors?: ValidationError[]
}
