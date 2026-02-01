import { useQuery } from '@tanstack/react-query'

import { authApi } from '@/shared/api'

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  sessions: () => [...userKeys.all, 'sessions'] as const,
}

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me(),
    queryFn: () => authApi.getMe(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  })
}

export function useSessions() {
  return useQuery({
    queryKey: userKeys.sessions(),
    queryFn: () => authApi.getSessions(),
    staleTime: 60 * 1000, // 1 minute
  })
}
