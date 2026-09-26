'use client'

import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { toast } from '@/shared/ui/toast'

import { userSessionsKeys } from './use-user-sessions'

export function useRevokeAllSessions(userId: string) {
  const queryClient = useQueryClient()
  const t = useTranslations('console')

  return useStepUpMutation({
    mutationFn: () => consoleApi.revokeAllUserSessions(userId),
    onSuccess: () => {
      toast.add({ type: 'success', title: t('userSessionsAllRevoked') })
      void queryClient.invalidateQueries({ queryKey: userSessionsKeys.all(userId) })
    },
  })
}
