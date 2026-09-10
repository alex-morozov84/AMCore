'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/shared/api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function useLogout() {
  const router = useRouteProgressRouter()
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
