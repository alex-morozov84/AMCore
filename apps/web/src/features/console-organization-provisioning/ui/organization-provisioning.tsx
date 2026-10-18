'use client'

import { type ReactNode, useId } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { coerceSupportedLocale, type ProductAccessBootstrap } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { provisioningClient } from '@/shared/api/console/provisioning-client'
import { getErrorCode } from '@/shared/api/errors'
import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'

import { useProvisioning } from '../model/use-provisioning'
import { useProvisioningInventoryRefresh } from '../model/use-provisioning-inventory-refresh'

import { ProvisioningOutcome } from './provisioning-outcome'
import { ProvisioningReceipt } from './provisioning-receipt'
import { ProvisioningWizard } from './provisioning-wizard'

function ProvisioningPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function BoundProvisioning({
  admission,
  orgId,
}: {
  admission: ProductAccessBootstrap
  orgId?: string
}) {
  const t = useTranslations('console.organizationProvisioning')
  const locale = useLocale()
  const flow = useProvisioning(admission, orgId)
  useProvisioningInventoryRefresh(flow.record?.organizationId, !!orgId)
  const throttled = useRetryDeadline(flow.retryAt)
  const blocked = throttled || !flow.policy.data?.createAllowed
  if (flow.retired) return <p role="alert">{t('sessionChanged')}</p>
  if (!flow.record) return <p role="status">{t('loading')}</p>
  if (
    orgId &&
    !flow.frozen &&
    flow.status.data?.state !== 'awaiting' &&
    !flow.status.isPending &&
    !flow.status.isError
  )
    return null
  const notManaged = getErrorCode(flow.error) === 'PROVISIONING_NOT_FOUND'
  if (orgId && notManaged && !flow.frozen) return null
  return (
    <div className="space-y-4">
      <ProvisioningPanel title={orgId ? t('detailTitle') : t('title')}>
        <div className="max-w-2xl space-y-5" aria-busy={flow.busy || flow.status.isFetching}>
          {!orgId && <p>{t('description')}</p>}
          {!flow.storageAvailable && <p role="alert">{t('storageUnavailable')}</p>}
          {notManaged ? <p>{t('notManaged')}</p> : <ApiErrorAlert error={flow.error} />}
          {flow.policy.data && !flow.policy.data.createAllowed && (
            <div className="space-y-2">
              <p role="alert">{t('emailBlocked')}</p>
              <Button
                variant="outline"
                disabled={flow.policy.isFetching}
                onClick={() => void flow.policy.refetch()}
              >
                {t('refreshReadiness')}
              </Button>
            </div>
          )}
          {flow.frozen ? (
            <div className="space-y-3">
              <p role="status">{t('unknown')}</p>
              <p>
                {t('requestId')}:{' '}
                <code className="break-all">
                  {flow.record.pending?.input.operationId ?? flow.record.expiredOperationId}
                </code>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={flow.busy || throttled}
                  onClick={() => void flow.check()}
                >
                  {t('checkResult')}
                </Button>
                {flow.record.pending && (
                  <Button disabled={flow.busy || throttled} onClick={() => void flow.submit()}>
                    {t('retrySame')}
                  </Button>
                )}
                {flow.expiredAbsent && (
                  <>
                    <p>{t('expiredAbsent')}</p>
                    <Button onClick={() => flow.start(coerceSupportedLocale(locale))}>
                      {t('start')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : orgId ? (
            flow.status.isPending ? (
              <p role="status">{t('loading')}</p>
            ) : null
          ) : flow.record.open ? (
            <ProvisioningWizard flow={flow} blocked={blocked} />
          ) : (
            !orgId && (
              <Button
                disabled={flow.busy || flow.policy.isPending}
                onClick={() => flow.start(coerceSupportedLocale(locale))}
              >
                {t('start')}
              </Button>
            )
          )}
          {orgId && flow.status.data && (
            <ProvisioningOutcome
              flow={flow}
              status={flow.status.data}
              blocked={throttled || flow.frozen || flow.busy}
            />
          )}
          <ConsoleStepUpDialog
            phase={flow.mutation.stepUp}
            isSubmitting={flow.mutation.isSteppingUp}
            onSubmit={flow.mutation.submitStepUp}
            onClose={flow.mutation.closeStepUp}
          />
        </div>
      </ProvisioningPanel>
      {!orgId && !flow.frozen && flow.createdId && (
        <ProvisioningReceipt organizationId={flow.createdId} onClose={flow.dismissCreated} />
      )}
    </div>
  )
}
export function OrganizationProvisioning({ orgId }: { orgId?: string }) {
  const t = useTranslations('console.organizationProvisioning')
  const instance = useId()
  const session = useQuery({
    queryKey: ['provisioning-session', instance],
    queryFn: ({ signal }) => provisioningClient.session(signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  if (session.isSuccess)
    return (
      <BoundProvisioning
        key={`${session.data.binding}:${session.data.actor.id}`}
        admission={session.data}
        orgId={orgId}
      />
    )
  return (
    <ProvisioningPanel title={orgId ? t('detailTitle') : t('title')}>
      <ApiErrorAlert error={session.error} />
      {session.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <Button variant="outline" onClick={() => void session.refetch()}>
          {t('retryLoading')}
        </Button>
      )}
    </ProvisioningPanel>
  )
}
