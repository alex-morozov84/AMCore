'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { ForgotPasswordInput } from '@amcore/shared'

import { type AuthActionBase, authActions } from '@/shared/api/auth-api'
import { useFormMutation } from '@/shared/hooks'

export function useForgotPassword(
  setError?: UseFormSetError<ForgotPasswordInput>,
  actionBase: AuthActionBase = '/auth'
) {
  return useFormMutation({
    mutationFn: (data: ForgotPasswordInput) => authActions(actionBase).forgotPassword(data),
    setError,
  })
}
