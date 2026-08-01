'use client'

import type { SupportedLocale } from '@amcore/shared'
import { useMutation } from '@tanstack/react-query'

import { authApi } from '@/shared/api'
import { useAuthStore } from '@/shared/store'

/**
 * Persist the chosen locale to the signed-in user's profile.
 *
 * Best-effort by design: a failed write must not block or revert the UI
 * language change. The cookie and URL still carry the choice for this browser,
 * so the worst case is that server-rendered email keeps the previous language
 * until the next successful update.
 */
export function usePersistLocale() {
  const setUser = useAuthStore((state) => state.setUser)

  const { mutate } = useMutation({
    mutationFn: (locale: SupportedLocale) => authApi.updateMe({ locale }),
    onSuccess: (response) => setUser(response.user),
  })

  return mutate
}
