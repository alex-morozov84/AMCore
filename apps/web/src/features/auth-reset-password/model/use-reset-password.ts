'use client'

import type { UseFormSetError } from 'react-hook-form'
import { resetPasswordSchema } from '@amcore/shared'
import type { z } from 'zod'

import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

// The form only ever collects the new password — `token` comes from the
// URL, not user input, so it's merged in by the caller at submit time
// rather than tracked as form state. Exported so the form and the mutation
// agree on exactly one shape for `setError`, instead of the UI file
// re-deriving a structurally-matching type by hand.
export const newPasswordSchema = resetPasswordSchema.pick({ password: true })
export type NewPasswordInput = z.infer<typeof newPasswordSchema>

export function useResetPassword(setError?: UseFormSetError<NewPasswordInput>) {
  return useFormMutation({
    mutationFn: (data: { password: string; token: string }) => authApi.resetPassword(data),
    setError,
  })
}
