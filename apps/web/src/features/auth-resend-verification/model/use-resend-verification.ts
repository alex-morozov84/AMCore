'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { ResendVerificationInput } from '@amcore/shared'

import { type AuthActionBase, authActions } from '@/shared/api/auth-api'
import { useFormMutation } from '@/shared/hooks'

export function useResendVerification(
  setError?: UseFormSetError<ResendVerificationInput>,
  actionBase: AuthActionBase = '/auth'
) {
  return useFormMutation({
    mutationFn: (data: ResendVerificationInput) => authActions(actionBase).resendVerification(data),
    setError,
  })
}
