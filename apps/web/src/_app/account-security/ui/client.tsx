'use client'

import { useEffect, useState } from 'react'
import {
  frontendAuthPath,
  type MfaBrowserResult,
  type MfaBrowserView,
  productAdminReturnPath,
} from '@amcore/shared'
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
        inspect: (operationId, flowBinding) =>
          apiClient.get<MfaBrowserView>(
            `${placement.apiBase}${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`,
            {
              headers: {
                'x-amcore-mfa-flow':
                  flowBinding ?? new URLSearchParams(window.location.search).get('flow') ?? '',
              },
            }
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
          const flowBinding = controller.getFlowBinding()
          if (flowBinding)
            await apiClient.post(placement.apiBase, {
              action: 'cancel',
              operationId: crypto.randomUUID(),
              flowBinding,
            })
          else
            await apiClient.post(placement.logoutPath, undefined, {
              headers: { 'x-amcore-context-session': controller.getSessionIntent() ?? '' },
            })
          router.replace(placement.loginHref)
        } finally {
          queryClient.clear()
        }
      }}
      onComplete={() => {
        const view = controller.getSnapshot().view
        if (view?.kind === 'flow' && view.invitationFlowId) {
          router.replace(
            frontendAuthPath(
              placement.apiBase === '/auth/mfa' ? 'site' : 'admin',
              `/invite/flow/${view.invitationFlowId}`
            )
          )
        } else if (view?.kind === 'flow' && view.returnTo) {
          router.replace(productAdminReturnPath(view.returnTo), { locale: view.returnTo.locale })
        } else router.replace(placement.completeHref)
      }}
    />
  )
}
