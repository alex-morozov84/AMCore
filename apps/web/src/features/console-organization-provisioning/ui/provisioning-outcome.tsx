'use client'

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { ProvisioningProgress } from '@amcore/shared'

import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'

import { ProvisioningActions } from './provisioning-actions'
import type { ProvisioningFlow } from './provisioning-wizard'

export function ProvisioningOutcome({
  flow,
  status,
  blocked,
}: {
  flow: ProvisioningFlow
  status: ProvisioningProgress
  blocked: boolean
}) {
  const t = useTranslations('console.organizationProvisioning')
  const admin = useTranslations('console.organizationAdministration')
  const format = useFormatter()
  const [checkedAt, setCheckedAt] = useState<number>()
  const awaiting = status.available && status.state === 'awaiting'
  const completed = status.available && status.state === 'completed'
  const check = () => {
    setCheckedAt(Date.now())
    void flow.check()
  }
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="font-semibold">
          {!status.available
            ? t('organizationUnavailable')
            : completed
              ? t('completed')
              : status.state === 'cancelled'
                ? t('cancelled')
                : t('pending')}
        </h3>
        {status.available && status.state === 'cancelled' && (
          <>
            <p>{t('cancelledHelp')}</p>
            <p className="text-sm text-muted-foreground">{t('cancelledNext')}</p>
          </>
        )}
        {completed && (
          <p>
            {status.access === 'original_grant_present'
              ? t('accessPresent')
              : status.access === 'removed'
                ? t('accessRemoved')
                : t('accessUnconfirmed')}
          </p>
        )}
        {awaiting && (
          <>
            <p>{status.invite ? t('pendingHelp') : t('invitationRemoved')}</p>
            {status.invite && (
              <dl className="space-y-1">
                <dt className="text-sm text-muted-foreground">{t('recipientLabel')}</dt>
                <dd className="break-all font-medium">{status.invite.email}</dd>
              </dl>
            )}
            {status.invite?.status === 'expired' && <p>{t('expired')}</p>}
            {status.mailOutcome && (
              <Alert
                variant={status.mailOutcome === 'provider_acknowledged' ? 'default' : 'warning'}
              >
                <AlertDescription>{t(`mail.${status.mailOutcome}`)}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>
      {(completed || (awaiting && !!status.invite)) && (
        <div className="space-y-3">
          {awaiting && <p className="text-sm text-muted-foreground">{t('checkHelp')}</p>}
          <Button
            className="h-auto min-h-8 whitespace-normal text-center"
            variant={awaiting ? 'default' : 'outline'}
            disabled={flow.busy || flow.status.isFetching || blocked}
            onClick={check}
          >
            {completed ? t('refreshAccess') : t('checkStatus')}
          </Button>
          {checkedAt &&
            flow.status.dataUpdatedAt >= checkedAt &&
            !flow.status.isFetching &&
            !flow.status.isError && (
              <p role="status" className="text-sm text-muted-foreground">
                {admin(
                  status.state === 'completed'
                    ? 'refreshAccepted'
                    : status.state === 'cancelled'
                      ? 'refreshCancelled'
                      : status.invite?.status === 'expired'
                        ? 'refreshExpired'
                        : status.invite?.status === 'pending'
                          ? 'refreshPending'
                          : 'refreshMissing'
                )}{' '}
                {admin('checkedAt', {
                  time: format.dateTime(new Date(flow.status.dataUpdatedAt), {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                })}
              </p>
            )}
        </div>
      )}
      {awaiting && (
        <ProvisioningActions key={status.revision} flow={flow} status={status} blocked={blocked} />
      )}
    </div>
  )
}
