'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'

import { StorageProbeIntervalForm } from './StorageProbeIntervalForm'
import { useStorageSetting } from './use-storage-setting'

export function StorageProbeIntervalEditor({ observedInterval }: { observedInterval: number }) {
  const t = useTranslations('console.storageSetting')
  const { query, mutation, notice, mustReread, reread, save, receipt, clearNotice } =
    useStorageSetting()
  const busy = mutation.isSubmitting || mutation.isSteppingUp || mutation.stepUp.kind !== 'closed'
  const saved = query.data
  const awaiting = saved && saved.saved.revision !== saved.applied.revision
  return (
    <div className="mt-3 space-y-2">
      {saved ? (
        <StorageProbeIntervalForm
          busy={busy}
          saving={mutation.isSubmitting || mutation.isSteppingUp}
          initialValue={saved.saved.intervalSeconds ?? saved.baselineSeconds}
          receipt={receipt}
          disabled={busy || mustReread}
          onSave={save}
          onCancel={clearNotice}
        />
      ) : (
        <p className="text-sm">{t('observed', { seconds: observedInterval })}</p>
      )}
      {notice ? (
        <p role="alert" className="text-sm text-warning">
          {notice}
        </p>
      ) : (
        saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {saved.applied.refreshStatus !== 'confirmed'
              ? t('refreshStale')
              : awaiting
                ? t('applying')
                : receipt
                  ? t('saved')
                  : null}
          </p>
        )
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-warning">
          {t('refreshFailed')}
        </p>
      )}
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {(mustReread || query.isError) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || query.isFetching}
          onClick={() => void reread()}
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
