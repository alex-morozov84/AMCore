'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { Skeleton } from '@/shared/ui/skeleton'

import type { AccountMfaController } from '../model/account-mfa-controller'
import { useAccountMfa } from '../model/use-account-mfa'

import { MfaActionButton, MfaActionLink, MfaActions } from './actions'
import { MfaEmergencyRecovery } from './emergency-recovery'
import { MfaFlow } from './mfa-flow'
import { MfaSecuritySettings } from './security-settings'

export function AccountMfaJourney({
  controller,
  onExit,
  onComplete,
  passwordRecoveryHref,
}: {
  controller: AccountMfaController
  onExit: () => void | Promise<void>
  onComplete: () => void
  passwordRecoveryHref?: string
}) {
  const t = useTranslations('accountMfa')
  const [exiting, setExiting] = useState(false)
  const [exitError, setExitError] = useState<unknown>()
  const [confirmExit, setConfirmExit] = useState(false)
  const state = useAccountMfa(controller)
  const pending = state.phase === 'submitting' || exiting
  const exit = async () => {
    if (exiting) return
    setExiting(true)
    setExitError(undefined)
    controller.conceal()
    try {
      await onExit()
    } catch {
      setExitError(new Error('MFA_EXIT_UNAVAILABLE'))
    } finally {
      setExiting(false)
    }
  }
  const { view } = state
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          {view && view.kind !== 'unavailable' && (
            <p className="min-w-0 break-all text-sm text-muted-foreground">{view.accountLabel}</p>
          )}
          {state.phase !== 'changed' && (
            <Button
              variant="ghost"
              className="ml-auto min-h-9 shrink-0 px-3"
              disabled={pending}
              onClick={() => {
                if (view?.kind === 'flow' && view.state === 'codes_pending') setConfirmExit(true)
                else void exit()
              }}
            >
              {t('exit')}
            </Button>
          )}
        </div>
        <CardTitle as="h1" className="text-2xl">
          {t('title')}
        </CardTitle>
        {view?.kind === 'flow' &&
          view.purpose === 'initial_setup' &&
          ['enrollment_required', 'codes_pending', 'completed'].includes(view.state) && (
            <p>
              {t(
                view.state === 'enrollment_required'
                  ? 'setupStep1'
                  : view.state === 'codes_pending'
                    ? 'setupStep2'
                    : 'setupStep3'
              )}
            </p>
          )}
      </CardHeader>
      <CardContent className="space-y-6">
        <ApiErrorAlert error={state.phase === 'unknown' ? undefined : state.error} />
        <ApiErrorAlert error={exitError} />
        {state.phase === 'loading' && !exitError && (
          <div role="status" aria-busy="true" className="space-y-3">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {state.phase === 'changed' && (
          <div className="space-y-4">
            <p role="alert">{t('sessionChanged')}</p>
            <MfaActions>
              <MfaActionButton disabled={exiting} onClick={() => void exit()}>
                {t('signInAgain')}
              </MfaActionButton>
            </MfaActions>
          </div>
        )}
        {state.phase === 'unknown' && (
          <div className="space-y-4">
            <p role="alert">{t('unknownResult')}</p>
            <p>{t('unknownCodeWarning')}</p>
            <MfaActions>
              <MfaActionButton onClick={() => void controller.inspect()}>
                {t('checkResult')}
              </MfaActionButton>
            </MfaActions>
          </div>
        )}
        {(state.phase === 'unavailable' || view?.kind === 'unavailable') && (
          <div className="space-y-4">
            <p role="status">{t('unavailable')}</p>
            <MfaActions>
              <MfaActionButton variant="outline" onClick={() => void controller.inspect()}>
                {t('checkAgain')}
              </MfaActionButton>
            </MfaActions>
          </div>
        )}
        {(state.phase === 'ready' || pending) && view?.kind === 'password_setup_required' && (
          <div className="space-y-4">
            <p>{t('passwordSetupDescription')}</p>
            {passwordRecoveryHref && (
              <MfaActions>
                <MfaActionLink href={passwordRecoveryHref}>{t('setPassword')}</MfaActionLink>
              </MfaActions>
            )}
            <p className="text-sm text-muted-foreground">{t('passwordSetupReturn')}</p>
          </div>
        )}
        {(state.phase === 'ready' || pending) && view?.kind === 'recovery_ticket' && (
          <MfaEmergencyRecovery
            pending={pending}
            onSubmit={(proof) =>
              void controller.command({ action: 'redeem_recovery_ticket', ...proof })
            }
          />
        )}
        {(state.phase === 'ready' || pending) && view?.kind === 'settings' && (
          <MfaSecuritySettings
            view={view}
            pending={pending}
            onAction={(action) => void controller.command({ action })}
          />
        )}
        {(state.phase === 'ready' || pending) && view?.kind === 'flow' && (
          <MfaFlow
            key={`${view.purpose}:${view.state}`}
            view={view}
            secrets={state.secrets}
            controller={controller}
            pending={pending}
            onComplete={onComplete}
            onRestart={() => void exit()}
          />
        )}

        <ConfirmDialog
          open={confirmExit}
          onOpenChange={setConfirmExit}
          title={t('exitBeforeSaving')}
          description={t('exitCodesWarning')}
          confirmLabel={t('exit')}
          cancelLabel={t('stay')}
          onConfirm={() => {
            setConfirmExit(false)
            void exit()
          }}
        />
      </CardContent>
    </Card>
  )
}
