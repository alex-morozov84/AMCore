'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { LoginInput } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { authApi } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'
import type { CredentialFormAdapter } from '@/shared/lib/credential-form-adapter'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function useLogin(
  setError?: UseFormSetError<LoginInput>,
  adapter?: CredentialFormAdapter<LoginInput>
) {
  const router = useRouteProgressRouter()
  const queryClient = useQueryClient()
  const guardedSetError: UseFormSetError<LoginInput> | undefined = setError
    ? (...args) => {
        if (!adapter || adapter.isCurrent()) setError(...args)
      }
    : undefined

  return useFormMutation({
    mutationFn: (data: LoginInput) => (adapter ? adapter.submit(data) : authApi.login(data)),
    retry: false,
    setError: guardedSetError,
    onSuccess: (response) => {
      if (adapter && !adapter.isCurrent()) return
      // Publish confirmed authentication into the server-state cache.
      queryClient.setQueryData(userKeys.me(), response)
      if (adapter) return adapter.onSuccess(response)
      // Honour the locale stored on the account, so a user whose preference is
      // Russian does not land on the English default after signing in.
      router.push('/', { locale: response.user.locale })
    },
  })
}
