import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { getValidationErrors } from '../api/errors'
import type { ValidationError } from '../api/types'

/**
 * Set server validation errors on React Hook Form fields
 *
 * @example
 * ```tsx
 * onError: (error) => {
 *   setServerErrors(error, form.setError)
 * }
 * ```
 */
export function setServerErrors<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>
): void {
  const validationErrors = getValidationErrors(error)

  if (validationErrors.length === 0) {
    return
  }

  validationErrors.forEach((err: ValidationError) => {
    // Convert field path (e.g., "profile.name") to React Hook Form path
    const fieldName = err.field as Path<TFieldValues>

    setError(fieldName, {
      type: 'server',
      message: err.message,
    })
  })
}

/**
 * Transform server validation errors to React Hook Form errors format
 * Useful for preview/debugging
 *
 * @returns Record of field names to error messages
 */
export function transformServerErrors<TFieldValues extends FieldValues>(
  error: unknown
): Partial<Record<keyof TFieldValues, string>> {
  const validationErrors = getValidationErrors(error)
  const errors: Partial<Record<keyof TFieldValues, string>> = {}

  validationErrors.forEach((err) => {
    const fieldName = err.field as keyof TFieldValues
    errors[fieldName] = err.message
  })

  return errors
}
