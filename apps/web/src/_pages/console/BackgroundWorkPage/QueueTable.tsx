'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueue } from '@amcore/shared'

import { InfoTooltip } from '@/shared/ui/info-tooltip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { QueueAge, useQueueFigures } from './QueueFigures'
import { QueueIdentity } from './QueueIdentity'
import { QueueStatus } from './QueueStatus'

const NUMERIC = 'text-right tabular-nums'

function Row({ queue, boardHref }: { queue: AdminQueue; boardHref: string | null }) {
  const figures = useQueueFigures(queue)
  return (
    <TableRow>
      <TableCell className="align-top whitespace-normal">
        <QueueIdentity queue={queue} boardHref={boardHref} />
      </TableCell>
      <TableCell className="align-top">
        <QueueStatus queue={queue} />
      </TableCell>
      <TableCell className={`${NUMERIC} align-top`}>{figures.waiting}</TableCell>
      <TableCell className={`${NUMERIC} align-top`}>{figures.active}</TableCell>
      <TableCell className={`${NUMERIC} align-top`}>{figures.delayed}</TableCell>
      <TableCell className={`${NUMERIC} align-top`}>{figures.failed}</TableCell>
      <TableCell className="align-top">
        <QueueAge queue={queue} />
      </TableCell>
    </TableRow>
  )
}

function HeadWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTooltip label={help} />
    </span>
  )
}

/** Desktop presentation (md and up). Hidden with `display: none` below, so assistive tech reads one list. */
export function QueueTable({
  queues,
  boardHrefOf = () => null,
}: {
  queues: AdminQueue[]
  boardHrefOf?: (queue: AdminQueue) => string | null
}) {
  const t = useTranslations('console.backgroundWork')
  return (
    <div className="hidden rounded-lg border bg-surface-elevated shadow-md md:block">
      <Table aria-label={t('tableLabel')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columnQueue')}</TableHead>
            <TableHead>{t('columnState')}</TableHead>
            <TableHead className="text-right">{t('columnWaiting')}</TableHead>
            <TableHead className="text-right">{t('columnActive')}</TableHead>
            <TableHead className="text-right">
              <HeadWithHelp label={t('columnDelayed')} help={t('delayedHint')} />
            </TableHead>
            <TableHead className="text-right">
              <HeadWithHelp label={t('columnFailed')} help={t('failedHint')} />
            </TableHead>
            <TableHead>
              <HeadWithHelp label={t('columnOldest')} help={t('oldestHint')} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queues.map((queue) => (
            <Row key={queue.name} queue={queue} boardHref={boardHrefOf(queue)} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
