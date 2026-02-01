import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { authApi, setAccessToken } from '@/shared/api'
import { useAuthStore } from '@/shared/store'

export function useLogout() {
  const router = useRouter()
  const logout = useAuthStore((state) => state.logout)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      setAccessToken(null)
      logout()
      queryClient.clear()
      router.push('/login')
    },
    onError: () => {
      // Even on error, clear local state
      setAccessToken(null)
      logout()
      queryClient.clear()
      router.push('/login')
    },
  })
}
