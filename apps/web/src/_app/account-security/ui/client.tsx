'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
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
  const requestedFlow = useSearchParams().get('flow') ?? ''
  return (
    <AccountSecurityInstance
      key={`${placement.apiBase}:${requestedFlow}`}
      placement={placement}
      requestedFlow={requestedFlow}
    />
  )
}

function AccountSecurityInstance({
  placement,
  requestedFlow,
}: {
  placement: AccountSecurityPlacement
  requestedFlow: string
}) {
  const router = useRouteProgressRouter()
  const queryClient = useQueryClient()
  const [controller] = useState(
    () =>
      new AccountMfaController({
        recoveryScope: `${placement.apiBase}:flow:${requestedFlow}`,
        inspect: (operationId, flowBinding) =>
          apiClient.get<MfaBrowserView>(
            `${placement.apiBase}${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`,
            {
              headers: {
                'x-amcore-mfa-flow': flowBinding ?? requestedFlow,
              },
            }
          ),
        command: (command) => apiClient.post<MfaBrowserResult>(placement.apiBase, command),
        resolveStart: (operationId, purpose) =>
          apiClient.post<MfaBrowserResult>(`${placement.apiBase}/settings-start/status`, {
            action: 'status',
            operationId,
            purpose,
          }),
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
          else if (controller.getSessionIntent())
            await apiClient.post(placement.logoutPath, undefined, {
              headers: { 'x-amcore-context-session': controller.getSessionIntent() ?? '' },
            })
          const restart = placement.loginHref.replace(/\/login$/, '/sign-in-again')
          router.replace(`${restart}?entryId=${crypto.randomUUID()}`)
        } finally {
          queryClient.clear()
        }
      }}
      onComplete={() => {
        const view = controller.getSnapshot().view
        if (view?.kind === 'flow' && view.purpose === 'rotate_codes') {
          void controller.resetToSettings()
          return
        }
        if (view?.kind === 'flow' && view.invitationFlowId) {
          router.replace(
            frontendAuthPath(
              placement.apiBase === '/auth/mfa' ? 'site' : 'admin',
              `/invite/flow/${view.invitationFlowId}`
            )
          )
        } else if (view?.kind === 'flow' && view.consoleReturn) {
          router.replace(view.consoleReturn.href, { locale: view.consoleReturn.locale })
        } else if (view?.kind === 'flow' && view.returnTo) {
          router.replace(productAdminReturnPath(view.returnTo), { locale: view.returnTo.locale })
        } else router.replace(placement.completeHref)
      }}
    />
  )
}
