'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueuesResponse } from '@amcore/shared'

import { getConsoleQueueBoardHref } from '@/shared/lib/console-public-href'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import { queueBoardHref, resolveBoardEntryState } from './board-entry-state'
import { QUEUE_BOARD_GUIDE_HREF } from './board-guide-link'
import { BoardNotices, BoardOpenAction } from './BoardEntry'
import { allUnavailable } from './queue-copy'
import { QueueCards } from './QueueCards'
import { QueueSummaryControls } from './QueueSummaryControls'
import { QueueTable } from './QueueTable'
import { useBoardOpenNotice } from './use-board-open-notice'
import { useQueueSummary } from './use-queue-summary'

/**
 * Interactive leaf of the page: the status line, controls and rows. The server renders the first
 * snapshot; this leaf keeps it fresh without replacing the surrounding RSC page. Keyed by the
 * snapshot's `checkedAt` so a re-admitted page starts from clean client state.
 */
export function QueueSummaryLive({
  initial,
  initialUpdatedAt,
  boardOpenFailed = false,
}: {
  initial: AdminQueuesResponse
  initialUpdatedAt: number
  /** A page load of the queue board just failed (`?board=unavailable`): a one-shot, historical marker. */
  boardOpenFailed?: boolean
}) {
  const summary = useQueueSummary(initial, initialUpdatedAt)
  const { data } = summary
  const openNotice = useBoardOpenNotice(boardOpenFailed, data?.board.state ?? null)
  const entryState = resolveBoardEntryState(data?.board, openNotice.failed)
  const canOpenBoard = entryState === 'available' || entryState === 'open-failed'

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
            leading={
              canOpenBoard && (
                <BoardOpenAction href={getConsoleQueueBoardHref()} onOpen={openNotice.clear} />
              )
            }
          />
        )}
      </div>
      <BoardNotices state={entryState} guideHref={QUEUE_BOARD_GUIDE_HREF} />
      {data && <QueueRows queues={data.queues} boardAvailable={data.board.state === 'available'} />}
    </>
  )
}

function QueueRows({
  queues,
  boardAvailable,
}: {
  queues: AdminQueuesResponse['queues']
  boardAvailable: boolean
}) {
  const t = useTranslations('console.backgroundWork')
  if (queues.length === 0) return <p className="text-sm text-muted-foreground">{t('noQueues')}</p>
  return (
    <>
      {allUnavailable(queues) && (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          {t('allUnavailable')}
        </p>
      )}
      <QueueTable queues={queues} boardHrefOf={(queue) => queueBoardHref(queue, boardAvailable)} />
      <QueueCards queues={queues} boardHrefOf={(queue) => queueBoardHref(queue, boardAvailable)} />
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
