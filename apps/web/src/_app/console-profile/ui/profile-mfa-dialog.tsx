'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'

import { AccountMfaController, AccountMfaJourney, useAccountMfa } from '@/features/account-mfa'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

import { consoleMfaAdapter } from './adapter'

export function ProfileMfaDialog({
  action,
  scope,
  onClose,
  onRestart,
}: {
  action: 'start_code_rotation' | 'start_replacement'
  scope: string
  onClose: () => void
  onRestart: () => void
}) {
  const t = useTranslations('accountMfa')
  const common = useTranslations('common')
  const router = useRouteProgressRouter()
  const queries = useQueryClient()
  const [controller] = useState(
    () => new AccountMfaController(consoleMfaAdapter(`console:${action}:${scope}`))
  )
  const state = useAccountMfa(controller)
  const [started, setStarted] = useState(false)
  const [warnClose, setWarnClose] = useState(false)
  const replacing = action === 'start_replacement'
  const initial = state.view?.kind === 'settings' && !started
  const successor = state.view?.kind === 'flow' && state.view.purpose === 'initial_setup'
  const close = () => {
    controller.conceal()
    if (successor || state.phase === 'changed') {
      queries.clear()
      onRestart()
    } else onClose()
  }
  const requestClose = () => {
    if (state.view?.kind === 'flow' && state.view.state === 'codes_pending') setWarnClose(true)
    else close()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent
        closeLabel={common('close')}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t(replacing ? 'replaceApp' : 'newCodes')}</DialogTitle>
          <DialogDescription>{t(replacing ? 'replaceWarning' : 'rotateWarning')}</DialogDescription>
        </DialogHeader>
        {warnClose && (
          <div className="space-y-4">
            <p role="alert">{t('exitCodesWarning')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setWarnClose(false)}>
                {t('stay')}
              </Button>
              <Button onClick={close}>{common('close')}</Button>
            </div>
          </div>
        )}
        <div hidden={warnClose}>
          {initial ? (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                {common('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setStarted(true)
                  void controller.command({ action })
                }}
              >
                {t('continue')}
              </Button>
            </div>
          ) : (
            <AccountMfaJourney
              controller={controller}
              embedded
              inspectOnMount={false}
              exitLabel={common('close')}
              onExit={close}
              onComplete={() => {
                controller.forgetCompleted()
                queries.clear()
                onClose()
                router.refresh()
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
