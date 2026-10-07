'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { InvitationInspectResponse } from '@amcore/shared'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

type ReadyInvitation = Extract<InvitationInspectResponse, { state: 'ready' }>
export type InvitationConsentProps = {
  invitation: ReadyInvitation
  accountEmail: string
  timeZone: string
  state: 'idle' | 'pending' | 'unknown'
  error?: unknown
  onAccept: () => void
  onRecover: () => void
  onLeave: () => void
}

/** Only render with a current verified inspect result; the headless controller owns admission. */
export function InvitationConsent({
  invitation,
  accountEmail,
  timeZone,
  state,
  error,
  onAccept,
  onRecover,
  onLeave,
}: InvitationConsentProps) {
  const t = useTranslations('invitationRecipient')
  const format = useFormatter()

  return (
    <section className="space-y-6" aria-busy={state === 'pending'}>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t('consentTitle', { organization: invitation.organization.name })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('currentAccount', { email: accountEmail })}
        </p>
      </div>
      <div className="space-y-3">
        <h2 className="font-medium">{t('rolesTitle')}</h2>
        <ul className="space-y-3 rounded-lg border bg-card p-4">
          {invitation.roles.map((role) => (
            <li key={role.id} className="space-y-1">
              <p className="font-medium">{role.name}</p>
              {role.description && (
                <p className="text-sm text-muted-foreground">{role.description}</p>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t('rolesHelp')}</p>
        <p className="text-sm text-muted-foreground">
          {t('expiresAt', {
            date: format.dateTime(new Date(invitation.expiresAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone,
            }),
          })}
        </p>
      </div>
      <ApiErrorAlert error={error} />
      {state === 'unknown' && (
        <div className="space-y-3 rounded-lg border bg-card p-4" role="status">
          <p className="text-sm">{t('unknownOutcome')}</p>
          <Button variant="outline" onClick={onRecover}>
            {t('recover')}
          </Button>
        </div>
      )}
      {state === 'pending' && (
        <p className="text-sm text-muted-foreground" role="status">
          {t('accepting')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={state !== 'idle'} onClick={onAccept}>
          {t('accept')}
        </Button>
        <Button variant="outline" onClick={onLeave}>
          {t('leave')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('leaveHelp')}</p>
    </section>
  )
}
