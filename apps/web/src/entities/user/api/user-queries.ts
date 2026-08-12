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

// `userKeys.sessions()` is kept as forward-looking key infra for the
// sessions-list slice; `useSessions()` itself is deferred until then —
// listing needs dedicated `GET /api/auth/sessions` BFF handlers (raw
// `refresh_token` to identify the "current" session), not built yet. See
// `ai/models-talk.md` "Iteration 2, slice 3" for the recorded contract.
