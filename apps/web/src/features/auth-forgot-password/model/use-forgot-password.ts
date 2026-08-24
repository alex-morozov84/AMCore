'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { ForgotPasswordInput } from '@amcore/shared'

import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useForgotPassword(setError?: UseFormSetError<ForgotPasswordInput>) {
  return useFormMutation({
    mutationFn: (data: ForgotPasswordInput) => authApi.forgotPassword(data),
    setError,
  })
}
