'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { LoginInput } from '@amcore/shared'

import { useRouter } from '@/i18n/navigation'
import { authApi, setAccessToken } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'
import { useAuthStore } from '@/shared/store'

export function useLogin(setError?: UseFormSetError<LoginInput>) {
  const router = useRouter()
  const login = useAuthStore((state) => state.login)

  return useFormMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    setError, // Automatically set field-level errors from server
    onSuccess: (response) => {
      setAccessToken(response.accessToken)
      login(response.user)
      // Honour the locale stored on the account, so a user whose preference is
      // Russian does not land on the English default after signing in.
      router.push('/', { locale: response.user.locale })
    },
  })
}
