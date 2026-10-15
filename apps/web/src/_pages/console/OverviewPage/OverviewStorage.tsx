import type { AdminOverviewResponse } from '@amcore/shared'

import { StorageProbeIntervalEditor } from '@/features/console-storage-setting'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import type { OverviewFormatter, OverviewTranslations } from './overview-types'
import {
  OverviewExposureBanner,
  OverviewPublicConfig,
  OverviewPublicState,
} from './OverviewPublicFiles'

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

function FilesRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

export function OverviewStorage({
  overview,
  t,
}: {
  overview: AdminOverviewResponse
  t: OverviewTranslations
  format: OverviewFormatter
}) {
  const { storage, publicDelivery } = overview
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md">
      <OverviewExposureBanner check={publicDelivery} t={t} />
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{t('overviewFilesTitle')}</h2>
        <InfoTooltip
          label={t('overviewFilesHelp', {
            interval: storage.intervalSeconds,
            stale: storage.staleAfterSeconds,
          })}
        />
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
      {storage.driver === 's3' && <OverviewPublicConfig check={publicDelivery} t={t} />}
      <div className="mt-4 divide-y rounded-md border">
        <FilesRow title={t('overviewPrivateFilesTitle')}>
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
        </FilesRow>
        <FilesRow title={t('overviewPublicFilesTitle')}>
          <OverviewPublicState check={publicDelivery} t={t} />
        </FilesRow>
      </div>
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
