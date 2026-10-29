'use client'

import { useEffect, useRef, useState } from 'react'
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
  embedded = false,
  exitLabel,
  inspectOnMount = true,
}: {
  controller: AccountMfaController
  onExit: () => void | Promise<void>
  onComplete: () => void
  passwordRecoveryHref?: string
  embedded?: boolean
  exitLabel?: string
  inspectOnMount?: boolean
}) {
  const t = useTranslations('accountMfa')
  const [exiting, setExiting] = useState(false)
  const [exitError, setExitError] = useState<unknown>()
  const [confirmExit, setConfirmExit] = useState(false)
  const state = useAccountMfa(controller, inspectOnMount)
  const navigated = useRef<string | undefined>(undefined)
  const completion = useRef(onComplete)
  useEffect(() => {
    completion.current = onComplete
  }, [onComplete])
  useEffect(() => {
    const view = state.view
    if (state.phase !== 'ready' || view?.kind !== 'flow') return
    if (
      view.state === 'completed' &&
      view.purpose === 'rotate_codes' &&
      navigated.current !== view.flowBinding
    ) {
      navigated.current = view.flowBinding
      completion.current()
      return
    }
    if (!['login', 'initial_setup'].includes(view.purpose)) return
    if (view.state === 'ready') void controller.command({ action: 'settle_login' })
    if (
      view.state === 'completed' &&
      view.publication === 'confirmed' &&
      navigated.current !== view.flowBinding
    ) {
      navigated.current = view.flowBinding
      completion.current()
    }
  }, [controller, state.phase, state.view])
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
  const Container = embedded ? 'div' : Card
  const Header = embedded ? 'div' : CardHeader
  const Content = embedded ? 'div' : CardContent
  return (
    <Container className="w-full max-w-lg">
      <Header className={embedded ? 'mb-4 space-y-3' : undefined}>
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
              {exitLabel ?? t('exit')}
            </Button>
          )}
        </div>
        {!embedded && (
          <CardTitle as="h1" className="text-2xl">
            {t('title')}
          </CardTitle>
        )}
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
      </Header>
      <Content className="space-y-6">
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
              <MfaActionButton onClick={() => void controller.reconcile()}>
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
        {state.phase === 'ready' && view?.kind === 'settings_start' && (
          <div className="space-y-4">
            <p role="status">
              {t(view.state === 'abandoned' ? 'startAbandoned' : 'startAdvanced')}
            </p>
            <MfaActions>
              <MfaActionButton onClick={onComplete}>{t('returnToSettings')}</MfaActionButton>
            </MfaActions>
          </div>
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

        {!embedded && (
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
        )}
        {embedded && confirmExit && (
          <div className="space-y-4" role="alert">
            <p>{t('exitCodesWarning')}</p>
            <MfaActions>
              <MfaActionButton variant="outline" onClick={() => setConfirmExit(false)}>
                {t('stay')}
              </MfaActionButton>
              <MfaActionButton
                onClick={() => {
                  setConfirmExit(false)
                  void exit()
                }}
              >
                {exitLabel ?? t('exit')}
              </MfaActionButton>
            </MfaActions>
          </div>
        )}
      </Content>
    </Container>
  )
}
