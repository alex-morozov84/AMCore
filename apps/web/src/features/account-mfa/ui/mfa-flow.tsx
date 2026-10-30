'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { MfaBrowserResult, MfaBrowserView, MfaMethod } from '@amcore/shared'

import type { AccountMfaController } from '../model/account-mfa-controller'

import { MfaActionButton as Button, MfaActions } from './actions'
import { MfaBackupCodes } from './backup-codes'
import { MfaEnrollment } from './enrollment'
import { MfaPasswordForm, MfaProofForm } from './proof-form'

export function MfaFlow({
  view,
  secrets,
  controller,
  pending,
  onComplete,
  onRestart,
}: {
  view: Extract<MfaBrowserView, { kind: 'flow' }>
  secrets: Pick<MfaBrowserResult, 'enrollment' | 'backupCodes'>
  controller: AccountMfaController
  pending: boolean
  onComplete: () => void
  onRestart: () => void
}) {
  const t = useTranslations('accountMfa')
  const [method, setMethod] = useState<MfaMethod>('totp')
  const [showEnrollment, setShowEnrollment] = useState(true)
  const command = controller.command.bind(controller)
  if (
    ['login', 'initial_setup'].includes(view.purpose) &&
    ['ready', 'completed'].includes(view.state)
  )
    return (
      <p role="status" aria-busy="true">
        {t('checking')}
      </p>
    )
  if (view.state === 'password_required')
    return (
      <div className="space-y-4">
        <p>{t('passwordDescription')}</p>
        <MfaPasswordForm
          pending={pending}
          onSubmit={(password) => void command({ action: 'confirm_password', password })}
        />
      </div>
    )
  if (view.state === 'enrollment_required')
    return secrets.enrollment && showEnrollment ? (
      <MfaEnrollment
        secret={secrets.enrollment.secret}
        uri={secrets.enrollment.otpauthUri}
        pending={pending}
        onSubmit={(proof) => void command({ action: 'verify', proof })}
        onBack={() => setShowEnrollment(false)}
        replacing={view.purpose === 'replace_factor'}
      />
    ) : (
      <div className="space-y-4">
        <p>{t('setupDescription')}</p>
        <MfaActions>
          <Button
            disabled={pending}
            onClick={() => {
              if (secrets.enrollment) setShowEnrollment(true)
              else void command({ action: 'start_enrollment' })
            }}
          >
            {t('connectApp')}
          </Button>
        </MfaActions>
      </div>
    )
  if (view.state === 'codes_pending' && secrets.backupCodes)
    return (
      <MfaBackupCodes
        key={secrets.backupCodes.generation}
        codes={secrets.backupCodes.codes}
        pending={pending}
        setup={view.purpose === 'initial_setup' || view.purpose === 'replace_factor'}
        onSaved={() =>
          void command({ action: 'acknowledge_codes', generation: secrets.backupCodes!.generation })
        }
      />
    )
  if (view.state === 'verify_required' || view.state === 'codes_pending') {
    const lost = view.state === 'codes_pending'
    if (lost && view.purpose === 'rotate_codes' && view.requiredProofs.length === 0)
      return (
        <div className="space-y-4">
          <p>{t('codesLost')}</p>
          <p>{t('rotateWarning')}</p>
          <MfaActions>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void command({ action: 'recover_codes' })}
            >
              {t('newCodes')}
            </Button>
          </MfaActions>
        </div>
      )
    const setupOnly = lost && ['initial_setup', 'replace_factor'].includes(view.purpose)
    const selected = setupOnly ? 'totp' : method
    return (
      <div className="space-y-4">
        <p>
          {t(
            lost
              ? 'codesLost'
              : selected === 'totp'
                ? 'verifyDescription'
                : 'backupLoginDescription'
          )}
        </p>
        {lost && <p>{t('rotateWarning')}</p>}
        <MfaProofForm
          key={selected}
          method={selected}
          pending={pending}
          destructive={lost}
          submitLabel={t(lost ? 'newCodes' : view.purpose === 'login' ? 'signIn' : 'continue')}
          onSubmit={(proof) => void command({ action: lost ? 'recover_codes' : 'verify', proof })}
        />
        <div className="flex flex-wrap gap-2">
          {!setupOnly && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setMethod(selected === 'totp' ? 'recovery_code' : 'totp')}
            >
              {t(selected === 'totp' ? 'noApp' : 'backToApp')}
            </Button>
          )}
          {view.purpose === 'login' && !lost && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void command({ action: 'start_recovery' })}
            >
              {t('emergencyEntry')}
            </Button>
          )}
        </div>
      </div>
    )
  }
  if (view.state === 'completed')
    return (
      <div className="space-y-4">
        <p role="status">{t(view.purpose === 'initial_setup' ? 'enabled' : 'completed')}</p>
        <MfaActions>
          <Button onClick={onComplete}>{t('continue')}</Button>
        </MfaActions>
      </div>
    )
  if (view.state === 'ready')
    return (
      <div className="space-y-4">
        <p>{t(view.purpose === 'rotate_codes' ? 'rotateWarning' : 'readyDescription')}</p>
        <MfaActions>
          <Button
            disabled={pending}
            variant={view.purpose === 'rotate_codes' ? 'destructive' : 'default'}
            onClick={() =>
              void command({
                action:
                  view.purpose === 'rotate_codes'
                    ? 'rotate_codes'
                    : view.purpose === 'replace_factor'
                      ? 'start_enrollment'
                      : view.purpose === 'reauthenticate'
                        ? 'complete_confirmation'
                        : 'complete_login',
              })
            }
          >
            {t(view.purpose === 'rotate_codes' ? 'newCodes' : 'continue')}
          </Button>
        </MfaActions>
      </div>
    )
  return (
    <div className="space-y-4">
      <p role="status">
        {t(
          view.state === 'attempts_exhausted'
            ? 'attemptsExhausted'
            : view.state === 'cancelled'
              ? 'cancelled'
              : 'restartRequired'
        )}
      </p>
      <MfaActions>
        <Button onClick={onRestart}>{t('signInAgain')}</Button>
      </MfaActions>
    </div>
  )
}
