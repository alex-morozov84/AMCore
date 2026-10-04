'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueue } from '@amcore/shared'

import { QueueAge, useQueueFigures } from './QueueFigures'
import { QueueIdentity } from './QueueIdentity'
import { QueueStatus } from './QueueStatus'

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Card({ queue }: { queue: AdminQueue }) {
  const t = useTranslations('console.backgroundWork')
  const figures = useQueueFigures(queue)
  return (
    <li className="rounded-lg border bg-surface-elevated p-4 shadow-md">
      <div className="flex items-start justify-between gap-3">
        <QueueIdentity queue={queue} />
        <QueueStatus queue={queue} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Figure label={t('columnWaiting')} value={figures.waiting} />
        <Figure label={t('columnActive')} value={figures.active} />
        <Figure label={t('columnDelayed')} value={figures.delayed} />
        <Figure label={t('columnFailed')} value={figures.failed} />
      </dl>
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">{t('columnOldest')}: </span>
        <QueueAge queue={queue} />
      </p>
    </li>
  )
}

/** Mobile presentation (below md): one card per queue. */
export function QueueCards({ queues }: { queues: AdminQueue[] }) {
  const t = useTranslations('console.backgroundWork')
  return (
    <ul aria-label={t('tableLabel')} className="flex flex-col gap-3 md:hidden">
      {queues.map((queue) => (
        <Card key={queue.name} queue={queue} />
      ))}
    </ul>
  )
}
