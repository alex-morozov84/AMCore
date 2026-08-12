'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useRouter } from '@/i18n/navigation'
import { authApi } from '@/shared/api'

export function useLogout() {
  const router = useRouter()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      // Clears the cached current-user query along with everything else —
      // the next `useCurrentUser()` mount re-fetches and correctly sees no
      // session, rather than serving stale cached user data.
      queryClient.clear()
      router.push('/login')
    },
    onError: () => {
      // Even on error, clear local state
      queryClient.clear()
      router.push('/login')
    },
  })
}
