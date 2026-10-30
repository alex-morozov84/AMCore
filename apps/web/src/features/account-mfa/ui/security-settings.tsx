'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { MfaBrowserAction, MfaBrowserView } from '@amcore/shared'

import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

import { MfaActionButton as Button, MfaActions } from './actions'

export function MfaSecuritySettings({
  view,
  pending,
  onAction,
  confirmActions = true,
}: {
  view: Extract<MfaBrowserView, { kind: 'settings' }>
  pending: boolean
  onAction: (action: MfaBrowserAction) => void
  confirmActions?: boolean
}) {
  const t = useTranslations('accountMfa')
  const [confirm, setConfirm] = useState<'rotate' | 'replace'>()
  if (!view.protected)
    return (
      <div className="space-y-4">
        <p>{t(view.eligible ? 'setupDescription' : 'notEligible')}</p>
        {view.eligible && (
          <MfaActions>
            <Button disabled={pending} onClick={() => onAction('start_setup')}>
              {t('startSetup')}
            </Button>
          </MfaActions>
        )}
      </div>
    )
  return (
    <div className="space-y-6">
      <p role="status">{t('enabled')}</p>
      <section className="space-y-3">
        <h2 className="font-semibold">{t('backupCodesTitle')}</h2>
        <p>{t('remainingCodes', { count: view.remainingCodes })}</p>
        {view.remainingCodes === 0 && <p>{t('noCodesLeft')}</p>}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => (confirmActions ? setConfirm('rotate') : onAction('start_code_rotation'))}
        >
          {t('newCodes')}
        </Button>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">{t('authenticator')}</h2>
        <p>{t('replaceDescription')}</p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => (confirmActions ? setConfirm('replace') : onAction('start_replacement'))}
        >
          {t('replaceApp')}
        </Button>
      </section>
      <ConfirmDialog
        open={confirm !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined)
        }}
        title={t(confirm === 'rotate' ? 'newCodes' : 'replaceApp')}
        description={t(confirm === 'rotate' ? 'rotateWarning' : 'replaceWarning')}
        confirmLabel={t('continue')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const action = confirm === 'rotate' ? 'start_code_rotation' : 'start_replacement'
          setConfirm(undefined)
          onAction(action)
        }}
      />
    </div>
  )
}
