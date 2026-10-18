'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'

import { useOrganizationSetup } from '../model/use-organization-setup'
import { useSetupInventoryRefresh } from '../model/use-setup-inventory-refresh'

import { SetupOutcome } from './setup-outcome'
import { SetupRecovery } from './setup-recovery'
import { SetupWizard } from './setup-wizard'

export type SetupFlow = ReturnType<typeof useOrganizationSetup>

/** Server state and frozen operations take precedence over editable steps. */
export function BoundSetup({ admission }: { admission: ProductAccessBootstrap }) {
  const t = useTranslations('console.organizationSetup')
  const flow = useOrganizationSetup(admission)
  const [trustedOpen, setTrustedOpen] = useState(false)
  const hasDraft =
    !!flow.record?.selected ||
    !!flow.record?.draft.email ||
    !!flow.record?.draft.name ||
    !!flow.record?.draft.slug
  const throttled = useRetryDeadline(flow.retryAt)
  const { status, account, mutation } = flow
  const installation = status.isSuccess ? status.data : undefined
  useSetupInventoryRefresh(installation?.state)
  const blocked = installation && installation.state !== 'eligible-empty'
  if (
    installation &&
    flow.record &&
    !flow.record.pending &&
    !flow.completedNow &&
    blocked &&
    (installation.state !== 'not-ready' || installation.reason === 'creation-enabled')
  )
    return null
  if (flow.retired) return <p role="alert">{t('sessionChanged')}</p>
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5" aria-busy={flow.busy || status.isFetching || account.isFetching}>
          {!flow.storageAvailable && (
            <Alert>
              <AlertDescription>{t('storageUnavailable')}</AlertDescription>
            </Alert>
          )}
          <ApiErrorAlert error={status.error ?? flow.error} />
          {blocked &&
            (!flow.record?.pending ||
              installation.state === 'completed-changed' ||
              flow.record.pending.kind === 'prepare') && (
              <SetupOutcome installation={installation} account={account.data} />
            )}
          {flow.record?.pending ? (
            <SetupRecovery flow={flow} throttled={throttled} />
          ) : !blocked && installation && flow.record ? (
            trustedOpen || hasDraft ? (
              <SetupWizard flow={flow} throttled={throttled} />
            ) : (
              <div className="space-y-3">
                <p className="max-w-2xl text-sm text-muted-foreground">{t('trustedHelp')}</p>
                <Button variant="outline" onClick={() => setTrustedOpen(true)}>
                  {t('trustedStart')}
                </Button>
              </div>
            )
          ) : !installation && status.isPending ? (
            <p role="status">{t('loading')}</p>
          ) : null}
          {(status.isError ||
            (blocked && ['not-ready', 'completed-changed'].includes(installation.state))) && (
            <Button
              variant="outline"
              disabled={flow.busy || throttled || status.isFetching}
              onClick={() => void flow.refresh()}
            >
              {t('refresh')}
            </Button>
          )}
          <ConsoleStepUpDialog
            phase={mutation.stepUp}
            isSubmitting={mutation.isSteppingUp}
            onSubmit={mutation.submitStepUp}
            onClose={mutation.closeStepUp}
          />
        </div>
      </CardContent>
    </Card>
  )
}
