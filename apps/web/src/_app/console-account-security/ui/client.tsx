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
        inspect: (operationId, flowBinding) =>
          apiClient.get<MfaBrowserView>(
            `${apiBase}${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`,
            {
              headers: {
                'x-amcore-mfa-flow':
                  flowBinding ?? new URLSearchParams(window.location.search).get('flow') ?? '',
              },
            }
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
          const flowBinding = controller.getFlowBinding()
          if (flowBinding)
            await apiClient.post(apiBase, {
              action: 'cancel',
              operationId: crypto.randomUUID(),
              flowBinding,
            })
          else
            await apiClient.post(
              host ? getConsolePublicApiPath('/auth/logout') : '/auth/logout',
              undefined,
              {
                headers: { 'x-amcore-context-session': controller.getSessionIntent() ?? '' },
              }
            )
          router.replace('/login')
        } finally {
          queryClient.clear()
        }
      }}
    />
  )
}
