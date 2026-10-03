'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { storageProbeSettingResponseSchema, type StorageProbeSettingUpdate } from '@amcore/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'

export function useStorageSetting() {
  const t = useTranslations('console.storageSetting')
  const [notice, setNotice] = useState<string>()
  const [mustReread, setMustReread] = useState(false)
  const [receipt, setReceipt] = useState<{ value: number; sequence: number }>()
  const instance = useId()
  const queryClient = useQueryClient()
  const queryKey = ['console', 'storage-probe-setting', instance]
  const intent = useRef<StorageProbeSettingUpdate | null>(null)
  const query = useQuery({
    queryKey,
    queryFn: async () =>
      storageProbeSettingResponseSchema.parse(await consoleApi.getStorageProbeSetting()),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: (q) =>
      q.state.data?.saved.revision !== q.state.data?.applied.revision ? 2000 : false,
  })
  async function reread() {
    const result = await query.refetch()
    if (result.isSuccess) setMustReread(false)
  }
  const mutation = useStepUpMutation({
    mutationFn: async () => {
      if (!intent.current) throw new Error('Missing captured setting intent')
      return storageProbeSettingResponseSchema.parse(
        await consoleApi.updateStorageProbeSetting(intent.current)
      )
    },
    onSuccess: (result) => {
      setReceipt((previous) => ({
        value: result.saved.intervalSeconds ?? result.baselineSeconds,
        sequence: (previous?.sequence ?? 0) + 1,
      }))
      queryClient.setQueryData(queryKey, result)
      setNotice(undefined)
      void reread()
    },
    onError: (error) => {
      const conflict = error instanceof ApiRequestError && error.status === 409
      const ambiguous =
        error instanceof ApiNetworkError ||
        (error instanceof ApiRequestError && error.status >= 500) ||
        !(error instanceof ApiRequestError)
      if (!conflict && !ambiguous) return false
      setMustReread(true)
      setNotice(t(conflict ? 'conflict' : 'statusFailed'))
      void reread()
      return true
    },
  })
  function save(intervalSeconds: number) {
    if (!query.data || mustReread) return
    intent.current = { intervalSeconds, expectedRevision: query.data.saved.revision }
    void mutation.confirm()
  }
  return {
    query,
    mutation,
    notice,
    mustReread,
    reread,
    save,
    receipt,
    clearNotice: () => {
      setNotice(undefined)
      void reread()
    },
  }
}
