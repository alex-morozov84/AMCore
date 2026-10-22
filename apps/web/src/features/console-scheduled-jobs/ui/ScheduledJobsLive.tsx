'use client'

import { useTranslations } from 'next-intl'
import type { ScheduledJobsResponse } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import { useScheduledJobs } from '../model/use-scheduled-jobs'

import { ScheduledJobsScopeProvider } from './scheduled-jobs-context'
import { ScheduledJobCards } from './ScheduledJobCards'
import { ScheduledJobsControls } from './ScheduledJobsControls'
import { ScheduledJobsTable } from './ScheduledJobsTable'

/**
 * Interactive leaf of the page: the data line, controls and rows. The server renders the first
 * snapshot; this leaf keeps it fresh without replacing the surrounding RSC page. Keyed by the
 * snapshot's `checkedAt` so a re-admitted page starts from clean client state.
 */
export function ScheduledJobsLive({
  initial,
  initialUpdatedAt,
}: {
  initial: ScheduledJobsResponse
  initialUpdatedAt: number
}) {
  const t = useTranslations('console.scheduledJobs')
  const live = useScheduledJobs(initial, initialUpdatedAt)
  const { data } = live
  const nobodyReported =
    data !== null &&
    data.jobs.length > 0 &&
    data.jobs.every((job) => job.config.state === 'not_reported')
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DataLine checkedAt={data?.checkedAt ?? null} refreshFailed={live.refreshFailed} />
        {data && (
          <ScheduledJobsControls
            auto={live.auto}
            onAutoChange={live.setAuto}
            onRefresh={() => void live.refresh()}
            isFetching={live.isFetching}
            canRefresh={live.canRefresh}
            online={live.online}
            retryAfterSeconds={live.retryAfterSeconds}
          />
        )}
      </div>
      {nobodyReported && (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          {t('nobodyReported')}
        </p>
      )}
      {data &&
        (data.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noJobs')}</p>
        ) : (
          <>
            <ScheduledJobsScopeProvider
              value={{
                instance: live.instance,
                onAccessLoss: live.reportAccessLoss,
                historyFloors: live.historyFloors,
                onHistoryFailure: live.reportHistoryFailure,
                onHistorySuccess: live.reportHistorySuccess,
              }}
            >
              <ScheduledJobsTable jobs={data.jobs} />
              <ScheduledJobCards jobs={data.jobs} />
            </ScheduledJobsScopeProvider>
            {data.jobs.some((job) => job.cadence === 'frequent') && (
              <p className="text-xs text-muted-foreground">{t('frequentFootnote')}</p>
            )}
          </>
        ))}
    </>
  )
}

/** When the rows were read, said honestly: a failed refresh never leaves old rows looking fresh. */
function DataLine({
  checkedAt,
  refreshFailed,
}: {
  checkedAt: string | null
  refreshFailed: boolean
}) {
  const t = useTranslations('console.scheduledJobs')
  if (!checkedAt) return <p className="text-sm text-muted-foreground">{t('accessChanged')}</p>
  const time = <ConsoleTimestamp value={checkedAt} variant="inline" seconds />
  return (
    <p
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
      role={refreshFailed ? 'status' : undefined}
    >
      {refreshFailed ? (
        <>
          {t('staleLead')} {time}. {t('staleTail')}
        </>
      ) : (
        <>
          {t('checkedAt')}: {time}
        </>
      )}
      <InfoTooltip label={t('dataHelp')} />
    </p>
  )
}
