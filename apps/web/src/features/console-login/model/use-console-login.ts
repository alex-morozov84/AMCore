'use client'

import type { UseFormSetError } from 'react-hook-form'
import type { LoginInput } from '@amcore/shared'

import { apiClient } from '@/shared/api'
import type { BrowserLoginResponse } from '@/shared/api/auth-api'
import { useFormMutation } from '@/shared/hooks'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function useConsoleLogin(setError?: UseFormSetError<LoginInput>) {
  const router = useRouteProgressRouter()

  return useFormMutation({
    retry: false,
    mutationFn: async (data: LoginInput) => {
      const bootstrap = await apiClient.post<{ attemptId: string }>(
        getConsolePublicApiPath('/auth/browser-context'),
        {}
      )
      return apiClient.post<BrowserLoginResponse>(getConsolePublicApiPath('/auth/login'), data, {
        headers: { 'x-amcore-login-attempt': bootstrap.attemptId },
      })
    },
    setError,
    onSuccess: (result) =>
      router.push('kind' in result ? `/mfa?flow=${encodeURIComponent(result.flowBinding)}` : '/'),
  })
}
