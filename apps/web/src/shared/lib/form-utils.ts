import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { getValidationErrors } from '../api/errors'
import type { ValidationError } from '../api/types'

/**
 * Set server validation errors on React Hook Form fields.
 *
 * `translate` is required and must localize by code — see
 * `useFieldErrorTranslator`. Most callers get this for free through
 * `useFormMutation` and never call this directly.
 *
 * @example
 * ```tsx
 * const translateFieldError = useFieldErrorTranslator()
 *
 * onError: (error) => {
 *   setServerErrors(error, form.setError, translateFieldError)
 * }
 * ```
 */
export function setServerErrors<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  translate: (err: ValidationError) => string
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
      // `translate`, never `err.message`: the wire message is English and
      // developer-facing. See `useFieldErrorTranslator`.
      message: translate(err),
    })
  })
}
