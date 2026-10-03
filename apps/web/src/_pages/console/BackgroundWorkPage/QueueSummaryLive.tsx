'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueuesResponse } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import { allUnavailable } from './queue-copy'
import { QueueCards } from './QueueCards'
import { QueueSummaryControls } from './QueueSummaryControls'
import { QueueTable } from './QueueTable'
import { useQueueSummary } from './use-queue-summary'

/**
 * Interactive leaf of the page: the status line, controls and rows. The server renders the first
 * snapshot; this leaf keeps it fresh without replacing the surrounding RSC page. Keyed by the
 * snapshot's `checkedAt` so a re-admitted page starts from clean client state.
 */
export function QueueSummaryLive({
  initial,
  initialUpdatedAt,
}: {
  initial: AdminQueuesResponse
  initialUpdatedAt: number
}) {
  const summary = useQueueSummary(initial, initialUpdatedAt)
  const { data } = summary

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <QueueStatusLine
          checkedAt={data?.checkedAt ?? null}
          refreshFailed={summary.refreshFailed}
        />
        {data && (
          <QueueSummaryControls
            auto={summary.auto}
            onAutoChange={summary.setAuto}
            onRefresh={() => void summary.refresh()}
            isFetching={summary.isFetching}
            canRefresh={summary.canRefresh}
            online={summary.online}
            retryAfterSeconds={summary.retryAfterSeconds}
          />
        )}
      </div>
      {data && <QueueRows queues={data.queues} />}
    </>
  )
}

function QueueRows({ queues }: { queues: AdminQueuesResponse['queues'] }) {
  const t = useTranslations('console.backgroundWork')
  if (queues.length === 0) return <p className="text-sm text-muted-foreground">{t('noQueues')}</p>
  return (
    <>
      {allUnavailable(queues) && (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          {t('allUnavailable')}
        </p>
      )}
      <QueueTable queues={queues} />
      <QueueCards queues={queues} />
    </>
  )
}

/** When the rows were read, said honestly: a failed refresh never leaves old rows looking fresh. */
function QueueStatusLine({
  checkedAt,
  refreshFailed,
}: {
  checkedAt: string | null
  refreshFailed: boolean
}) {
  const t = useTranslations('console.backgroundWork')
  if (!checkedAt) return <p className="text-sm text-muted-foreground">{t('accessChanged')}</p>
  const time = <ConsoleTimestamp value={checkedAt} variant="inline" seconds />
  return (
    <p className="text-sm text-muted-foreground" role={refreshFailed ? 'status' : undefined}>
      {refreshFailed ? (
        t.rich('staleNotice', { time: () => time })
      ) : (
        <>
          {t('checkedAt')}: {time}
        </>
      )}
    </p>
  )
}
