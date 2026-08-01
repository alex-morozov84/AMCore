'use client'

import { type FieldValues, type UseFormSetError } from 'react-hook-form'
import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

import { setServerErrors } from '../lib/form-utils'
import { useFieldErrorTranslator } from '../lib/use-field-error-translator'

/**
 * Extended mutation options with form error handling
 */
export interface UseFormMutationOptions<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
  TFieldValues extends FieldValues = FieldValues,
> extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'onError'> {
  /** React Hook Form setError function */
  setError?: UseFormSetError<TFieldValues>
  /** Custom error handler (called after setting form errors) */
  onError?: (
    error: TError,
    variables: TVariables,
    context: TContext | undefined
  ) => void | Promise<void>
}

/**
 * TanStack Query mutation with automatic React Hook Form error handling
 *
 * Automatically maps server validation errors to form fields.
 *
 * Field errors are localized by code, never by the backend's wire `message`.
 *
 * @example
 * ```tsx
 * const form = useLocalizedForm<LoginInput>(loginSchema, { ... })
 * const describeError = useApiError()
 *
 * const { mutate, isPending, error } = useFormMutation({
 *   mutationFn: authApi.login,
 *   setError: form.setError,
 *   onSuccess: (data) => {
 *     // Handle success
 *   },
 *   onError: (error) => {
 *     // Custom error handling (optional)
 *     toast.error(describeError(error).message)
 *   }
 * })
 * ```
 */
export function useFormMutation<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
  TFieldValues extends FieldValues = FieldValues,
>(options: UseFormMutationOptions<TData, TError, TVariables, TContext, TFieldValues>) {
  const { setError, onError, ...mutationOptions } = options
  const translateFieldError = useFieldErrorTranslator()

  return useMutation({
    ...mutationOptions,
    onError: async (error, variables, context) => {
      // Automatically set server validation errors on form fields, localized
      // by code — never the backend's English `message`.
      if (setError) {
        setServerErrors(error, setError, translateFieldError)
      }

      // Call custom error handler if provided
      if (onError) {
        await onError(error, variables, context)
      }
    },
  })
}
