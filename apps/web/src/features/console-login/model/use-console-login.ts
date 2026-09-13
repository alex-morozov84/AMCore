'use client'

import type { UseFormSetError } from 'react-hook-form'
import { useLocale } from 'next-intl'
import type { LoginInput } from '@amcore/shared'

import { apiClient } from '@/shared/api'
import { useFormMutation } from '@/shared/hooks'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function useConsoleLogin(setError?: UseFormSetError<LoginInput>) {
  const locale = useLocale()
  const router = useRouteProgressRouter()

  return useFormMutation({
    mutationFn: (data: LoginInput) =>
      apiClient.post<void>(getConsolePublicApiPath('/auth/login'), data),
    setError,
    onSuccess: () => router.push('/', { locale }),
  })
}
