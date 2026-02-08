import type { UseFormSetError } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import type { LoginInput } from '@amcore/shared'

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
      router.push('/')
    },
  })
}
