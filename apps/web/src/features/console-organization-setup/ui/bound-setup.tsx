'use client'

import { useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
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
  const throttled = useRetryDeadline(flow.retryAt)
  const { status, account, mutation } = flow
  const installation = status.isSuccess ? status.data : undefined
  useSetupInventoryRefresh(installation?.state)
  const blocked = installation && installation.state !== 'eligible-empty'
  if (flow.retired) return <p role="alert">{t('sessionChanged')}</p>
  return (
    <div className="space-y-5" aria-busy={flow.busy || status.isFetching || account.isFetching}>
      {!flow.storageAvailable && (
        <Alert>
          <AlertDescription>{t('storageUnavailable')}</AlertDescription>
        </Alert>
      )}
      <ApiErrorAlert error={status.error ?? flow.error} />
      {blocked && <SetupOutcome installation={installation} account={account.data} />}
      {flow.record?.pending ? (
        <SetupRecovery flow={flow} throttled={throttled} />
      ) : !blocked && installation && flow.record ? (
        <SetupWizard flow={flow} throttled={throttled} />
      ) : !installation && status.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : null}
      {(status.isError || (blocked && installation.state !== 'completed-intact')) && (
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
  )
}
