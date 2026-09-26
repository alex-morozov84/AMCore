'use client'

import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { toast } from '@/shared/ui/toast'

import { userSessionsKeys } from './use-user-sessions'

/** One hook instance per row, bound to that row's own family — mirrors `UserRoleAction`'s per-row hook pattern. */
export function useRevokeSession(userId: string, sessionId: string) {
  const queryClient = useQueryClient()
  const t = useTranslations('console')

  return useStepUpMutation({
    mutationFn: () => consoleApi.revokeUserSession(userId, sessionId),
    onSuccess: () => {
      toast.add({ type: 'success', title: t('userSessionsRevoked') })
      void queryClient.invalidateQueries({ queryKey: userSessionsKeys.all(userId) })
    },
  })
}
