'use client'

import { type FieldValues, useForm, type UseFormProps, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { $ZodType } from 'zod/v4/core'

import { useZodErrorMap } from '../lib/zod-error-map'

/**
 * `useForm` with Zod validation localized in the active locale.
 *
 * Wraps the resolver so every form gets the per-parse error map without having
 * to remember it — forgetting it would not fail anything loudly, it would just
 * silently render Zod's built-in English.
 *
 * @example
 * const form = useLocalizedForm(loginSchema, { defaultValues: { email: '' } })
 */
export function useLocalizedForm<TFieldValues extends FieldValues>(
  schema: $ZodType<unknown, TFieldValues>,
  options?: Omit<UseFormProps<TFieldValues>, 'resolver'>
): UseFormReturn<TFieldValues> {
  const errorMap = useZodErrorMap()

  return useForm<TFieldValues>({
    ...options,
    resolver: zodResolver(schema, { error: errorMap }) as UseFormProps<TFieldValues>['resolver'],
  })
}
