'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { LoginInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { useRouter } from '@/i18n/navigation'
import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'

export function useLogin(setError?: UseFormSetError<LoginInput>) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useFormMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    setError, // Automatically set field-level errors from server
    onSuccess: (response) => {
      // The current user is server state — TanStack Query owns it, not a
      // separate client store (ai/models-talk.md "UI-rewiring slice").
      queryClient.setQueryData(userKeys.me(), response)
      // Honour the locale stored on the account, so a user whose preference is
      // Russian does not land on the English default after signing in.
      router.push('/', { locale: response.user.locale })
    },
  })
}
