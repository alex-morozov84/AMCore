import { type FieldValues, type UseFormSetError } from 'react-hook-form'
import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

import { setServerErrors } from '../lib/form-utils'

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
 * @example
 * ```tsx
 * const form = useForm<LoginInput>({ ... })
 *
 * const { mutate, isPending, error } = useFormMutation({
 *   mutationFn: authApi.login,
 *   setError: form.setError,
 *   onSuccess: (data) => {
 *     // Handle success
 *   },
 *   onError: (error) => {
 *     // Custom error handling (optional)
 *     toast.error(getErrorMessage(error))
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

  return useMutation({
    ...mutationOptions,
    onError: async (error, variables, context) => {
      // Automatically set server validation errors on form fields
      if (setError) {
        setServerErrors(error, setError)
      }

      // Call custom error handler if provided
      if (onError) {
        await onError(error, variables, context)
      }
    },
  })
}
