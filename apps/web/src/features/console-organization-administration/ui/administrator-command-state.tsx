'use client'

import { useTranslations } from 'next-intl'

import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'

import type { useAdministratorCommand } from '../model/use-administrator-command'

export type AdministratorCommandFlow = ReturnType<typeof useAdministratorCommand>
export function AdministratorCommandState({ flow }: { flow: AdministratorCommandFlow }) {
  const t = useTranslations('console.organizationAdministration')
  const throttled = useRetryDeadline(flow.retryAt)
  if (flow.retired) return <p role="alert">{t('sessionChanged')}</p>
  return (
    <div className="space-y-3">
      <ApiErrorAlert error={flow.error} />
      {!flow.storageAvailable && <p role="alert">{t('storageUnavailable')}</p>}
      {flow.record && (
        <div className="space-y-3" role="status">
          <p>{t('unknown')}</p>
          <p>
            {t('operationId')}: <code className="break-all">{flow.record.operationId}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={flow.busy || throttled}
              onClick={() => void flow.check()}
            >
              {t('checkResult')}
            </Button>
            {flow.expiredUnrecorded && (
              <div className="space-y-3">
                <p>{t('expiredUnrecorded')}</p>
                <Button variant="outline" disabled={flow.busy} onClick={flow.acknowledgeExpired}>
                  {t('acknowledgeExpired')}
                </Button>
              </div>
            )}
            {flow.record.pending && !flow.expiredUnrecorded && (
              <Button
                disabled={flow.busy || throttled || !flow.storageAvailable}
                onClick={() => void flow.mutation.confirm()}
              >
                {t('retrySame')}
              </Button>
            )}
          </div>
        </div>
      )}
      <ConsoleStepUpDialog
        phase={flow.mutation.stepUp}
        isSubmitting={flow.mutation.isSteppingUp}
        onSubmit={flow.mutation.submitStepUp}
        onClose={flow.mutation.closeStepUp}
      />
    </div>
  )
}
