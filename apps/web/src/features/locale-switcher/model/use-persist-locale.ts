'use client'

import type { CatalogueLocale, UserResponse } from '@amcore/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { authApi } from '@/shared/api'
import { captureQuerySession, isCurrentQuerySession } from '@/shared/api/query-session'

/**
 * Persist the chosen locale to the signed-in user's profile.
 *
 * Best-effort by design: a failed write must not block or revert the UI
 * language change. The cookie and URL still carry the choice for this browser,
 * so the worst case is that server-rendered email keeps the previous language
 * until the next successful update.
 */
export function usePersistLocale() {
  const queryClient = useQueryClient()

  const { mutate } = useMutation({
    mutationFn: (locale: CatalogueLocale) => authApi.updateMe({ locale }),
    onMutate: () => captureQuerySession(queryClient),
    onSuccess: (response, _locale, captured) => {
      if (!isCurrentQuerySession(queryClient, captured)) return
      queryClient.setQueryData<{ user: UserResponse | null; contextSession?: string }>(
        userKeys.me(),
        (old) => (old ? { ...old, user: response.user } : old)
      )
    },
  })

  return mutate
}
