import type { AdminOverviewResponse } from '@amcore/shared'

import { StorageProbeIntervalEditor } from '@/features/console-storage-setting'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import type { OverviewFormatter, OverviewTranslations } from './overview-types'

const STATES = {
  healthy: 'overviewFilesHealthy',
  failed: 'overviewFilesFailed',
  unknown: 'overviewFilesUnknown',
  stale: 'overviewFilesStale',
} as const
const FAILURES = {
  access_denied: 'overviewFilesAccessDenied',
  timeout: 'overviewFilesTimeout',
  content_mismatch: 'overviewFilesMismatch',
  io_error: 'overviewFilesIoError',
} as const

export function OverviewStorage({
  overview,
  t,
}: {
  overview: AdminOverviewResponse
  t: OverviewTranslations
  format: OverviewFormatter
}) {
  const { storage } = overview
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t('overviewFilesTitle')}</h2>
          <InfoTooltip
            label={t('overviewFilesHelp', {
              interval: storage.intervalSeconds,
              stale: storage.staleAfterSeconds,
            })}
          />
        </div>
        <div className="space-y-1 text-sm sm:text-right">
          <p className={storage.state === 'healthy' ? 'text-success' : 'text-warning'}>
            {t(STATES[storage.state])}
          </p>
          <p>
            {t('overviewFilesLastCheck')}:{' '}
            {storage.checkedAt ? (
              <ConsoleTimestamp value={storage.checkedAt} variant="inline" seconds />
            ) : (
              t('overviewFilesUnmeasured')
            )}
          </p>
          <p>
            {t('overviewFilesNextCheck')}:{' '}
            {storage.inProgress ? (
              t('overviewFilesWaiting')
            ) : storage.nextScheduledAt ? (
              <ConsoleTimestamp value={storage.nextScheduledAt} variant="inline" seconds />
            ) : (
              t('overviewFilesUnscheduled')
            )}
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {t(
          storage.driver === 's3'
            ? 'overviewFilesS3'
            : storage.driver === 'local'
              ? 'overviewFilesLocal'
              : 'overviewFilesMemory'
        )}
      </p>
      <StorageProbeIntervalEditor observedInterval={storage.intervalSeconds} />
      {storage.driver === 's3' && (
        <aside className="mt-3 rounded-md border border-warning p-3 text-sm">
          <p className="font-semibold">{t('overviewFilesCostTitle')}</p>
          <p className="mt-1">{t('overviewFilesCostHelp')}</p>
        </aside>
      )}
      {storage.failure && <p className="mt-2 text-sm">{t(FAILURES[storage.failure])}</p>}
    </section>
  )
}
