'use client'

import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { userKeys } from '@/entities/user'
import { authApi, useApiError } from '@/shared/api'
import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import { captureQuerySession, isCurrentQuerySession } from '@/shared/api/query-session'
import { toast } from '@/shared/ui/toast'

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  const t = useTranslations('sessions')
  const describeError = useApiError()

  return useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onMutate: () => {
      const captured = captureQuerySession(queryClient)
      if (!captured.owner || !captured.query)
        throw new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
      return captured
    },
    onSuccess: (_response, _input, captured) => {
      if (!captured || !isCurrentQuerySession(queryClient, captured)) return
      toast.add({ type: 'success', title: t('othersRevoked') })
      void queryClient.invalidateQueries({ queryKey: userKeys.sessionsAll(captured.owner) })
    },
    onError: (error) => {
      toast.add({ type: 'error', title: describeError(error).message })
    },
  })
}
