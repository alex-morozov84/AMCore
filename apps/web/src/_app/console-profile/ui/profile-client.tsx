'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { MfaBrowserAction } from '@amcore/shared'

import { AccountMfaController, MfaSecuritySettings, useAccountMfa } from '@/features/account-mfa'
import { getConsoleSignInAgainHref } from '@/shared/lib/console-public-href'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

import { consoleMfaAdapter } from './adapter'
import { ProfileMfaDialog } from './profile-mfa-dialog'

export function ConsoleProfileClient({ scope }: { scope: string }) {
  const t = useTranslations('accountMfa')
  const router = useRouteProgressRouter()
  const [controller] = useState(
    () => new AccountMfaController(consoleMfaAdapter(`console:settings:${scope}`))
  )
  const state = useAccountMfa(controller)
  const [action, setAction] =
    useState<Extract<MfaBrowserAction, 'start_code_rotation' | 'start_replacement'>>()
  const restart = () =>
    router.replace(`${getConsoleSignInAgainHref()}?entryId=${crypto.randomUUID()}`)
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle as="h2" className="text-xl">
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ApiErrorAlert error={state.error} />
        {state.phase === 'loading' && (
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {state.phase === 'ready' && state.view?.kind === 'settings' && (
          <MfaSecuritySettings
            view={state.view}
            pending={false}
            confirmActions={false}
            onAction={(next) => {
              if (next === 'start_code_rotation' || next === 'start_replacement') setAction(next)
            }}
          />
        )}
        {state.phase === 'changed' && (
          <div className="space-y-3">
            <p role="alert">{t('sessionChanged')}</p>
            <Button onClick={restart}>{t('signInAgain')}</Button>
          </div>
        )}
        {state.phase === 'unavailable' && (
          <Button variant="outline" onClick={() => void controller.inspect()}>
            {t('checkAgain')}
          </Button>
        )}
        {action && (
          <ProfileMfaDialog
            key={action}
            action={action}
            scope={scope}
            onClose={() => {
              setAction(undefined)
              void controller.resetToSettings()
            }}
            onRestart={restart}
          />
        )}
      </CardContent>
    </Card>
  )
}
