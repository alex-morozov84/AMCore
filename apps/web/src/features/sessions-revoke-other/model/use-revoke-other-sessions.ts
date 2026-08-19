'use client'

import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { authApi, useApiError } from '@/shared/api'
import { toast } from '@/shared/ui/toast'

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  const t = useTranslations('sessions')
  const describeError = useApiError()

  return useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      toast.add({ type: 'success', title: t('othersRevoked') })
      queryClient.invalidateQueries({ queryKey: userKeys.sessionsAll() })
    },
    onError: (error) => {
      toast.add({ type: 'error', title: describeError(error).message })
    },
  })
}
