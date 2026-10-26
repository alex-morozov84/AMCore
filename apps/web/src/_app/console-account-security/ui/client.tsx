'use client'

import { useEffect, useState } from 'react'
import type { MfaBrowserResult, MfaBrowserView } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { AccountMfaController, AccountMfaJourney } from '@/features/account-mfa'
import { apiClient } from '@/shared/api/http-client'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { getConsoleOverviewHref } from '@/shared/lib/console-public-href'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function ConsoleAccountSecurityClient() {
  const router = useRouteProgressRouter()
  const queryClient = useQueryClient()
  const apiBase = getConsolePublicApiPath('/auth/mfa')
  const [controller] = useState(
    () =>
      new AccountMfaController({
        inspect: (operationId) =>
          apiClient.get<MfaBrowserView>(
            `${apiBase}${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`
          ),
        command: (command) => apiClient.post<MfaBrowserResult>(apiBase, command),
      })
  )
  useEffect(
    () =>
      controller.subscribe(() => {
        if (controller.getSnapshot().phase === 'changed') queryClient.clear()
      }),
    [controller, queryClient]
  )
  return (
    <AccountMfaJourney
      controller={controller}
      onComplete={() => router.replace(getConsoleOverviewHref())}
      onExit={async () => {
        try {
          const host = ADMIN_CONSOLE_CONFIG.mode === 'host'
          await apiClient.post(host ? getConsolePublicApiPath('/auth/logout') : '/auth/logout')
          router.replace('/login')
        } finally {
          queryClient.clear()
        }
      }}
    />
  )
}
