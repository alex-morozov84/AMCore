'use client'

import { useEffect, useState } from 'react'
import type { MfaBrowserResult, MfaBrowserView } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { AccountMfaController, AccountMfaJourney } from '@/features/account-mfa'
import { apiClient } from '@/shared/api/http-client'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export interface AccountSecurityPlacement {
  apiBase: '/auth/mfa' | '/product-admin/auth/mfa'
  logoutPath: '/auth/logout' | '/product-admin/auth/logout'
  passwordRecoveryHref: string
  loginHref: string
  completeHref: string
}

export function AccountSecurityClient({ placement }: { placement: AccountSecurityPlacement }) {
  const router = useRouteProgressRouter()
  const queryClient = useQueryClient()
  const [controller] = useState(
    () =>
      new AccountMfaController({
        inspect: (operationId) =>
          apiClient.get<MfaBrowserView>(
            `${placement.apiBase}${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`
          ),
        command: (command) => apiClient.post<MfaBrowserResult>(placement.apiBase, command),
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
      passwordRecoveryHref={placement.passwordRecoveryHref}
      onExit={async () => {
        try {
          await apiClient.post(placement.logoutPath)
          router.replace(placement.loginHref)
        } finally {
          queryClient.clear()
        }
      }}
      onComplete={() => router.replace(placement.completeHref)}
    />
  )
}
