'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { SupportedLocale } from '@amcore/shared'

import { LoginForm } from '@/features/auth-login'
import { type AuthActionBase, authActions, PendingBrowserFlowError } from '@/shared/api/auth-api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export interface SignInAgainPlacement {
  apiBase: AuthActionBase
  mfaHref: string
  destination: string
  entryKind?: 'console'
}
export function SignInAgainClient({
  placement,
  entryId,
  returnEntryId,
  locale,
}: {
  placement: SignInAgainPlacement
  entryId: string
  returnEntryId?: string
  locale: SupportedLocale
}) {
  const router = useRouteProgressRouter()
  const t = useTranslations('auth')
  const [pendingFlow, setPendingFlow] = useState<string>()
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const actions = authActions(placement.apiBase, {
    entryId,
    locale,
    entryKind: placement.entryKind,
    returnEntryId,
  })
  if (pendingFlow)
    return (
      <div className="space-y-4">
        <p role="status">{t('existingSignInHelp')}</p>
        <RouteProgressLink href={`${placement.mfaHref}?flow=${encodeURIComponent(pendingFlow)}`}>
          {t('existingSignInAction')}
        </RouteProgressLink>
      </div>
    )
  return (
    <LoginForm
      adapter={{
        submit: async (input) => {
          try {
            return await actions.login(input)
          } catch (error) {
            if (error instanceof PendingBrowserFlowError && active.current)
              setPendingFlow(error.flowBinding)
            throw error
          }
        },
        isCurrent: () => active.current,
        onMfaRequired: (flowBinding) =>
          router.replace(`${placement.mfaHref}?flow=${encodeURIComponent(flowBinding)}`),
        onSuccess: () => router.replace(placement.destination, { locale }),
      }}
    />
  )
}
