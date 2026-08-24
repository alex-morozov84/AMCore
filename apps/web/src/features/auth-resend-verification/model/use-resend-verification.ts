'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { ResendVerificationInput } from '@amcore/shared'

import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useResendVerification(setError?: UseFormSetError<ResendVerificationInput>) {
  return useFormMutation({
    mutationFn: (data: ResendVerificationInput) => authApi.resendVerification(data),
    setError,
  })
}
