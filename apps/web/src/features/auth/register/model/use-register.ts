import { useRouter } from 'next/navigation'
import type { RegisterInput } from '@amcore/shared'
import { useMutation } from '@tanstack/react-query'

import { authApi, setAccessToken } from '@/shared/api'
import { useAuthStore } from '@/shared/store'

export function useRegister() {
  const router = useRouter()
  const login = useAuthStore((state) => state.login)

  return useMutation({
    mutationFn: (data: RegisterInput) => authApi.register(data),
    onSuccess: (response) => {
      setAccessToken(response.accessToken)
      login(response.user)
      router.push('/')
    },
  })
}
