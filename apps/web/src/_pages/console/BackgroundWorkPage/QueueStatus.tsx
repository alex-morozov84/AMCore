'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueue } from '@amcore/shared'
import { CircleSlash, PauseCircle, TriangleAlert } from 'lucide-react'

import { isEmpty } from './queue-copy'

/**
 * Neutral state of one row. It never claims a queue is "healthy" or "running": pause is a flag,
 * and an empty or idle queue says nothing about whether a worker exists.
 */
export function QueueStatus({ queue }: { queue: AdminQueue }) {
  const t = useTranslations('console.backgroundWork')
  if (queue.status === 'unavailable') {
    return (
      <p className="flex items-center gap-1.5 text-warning">
        <TriangleAlert className="size-4" aria-hidden="true" />
        {t('unavailable')}
      </p>
    )
  }
  if (queue.status === 'disabled') {
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <CircleSlash className="size-4" aria-hidden="true" />
        {t('disabled')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {queue.paused ? (
        <p className="flex items-center gap-1.5 text-warning">
          <PauseCircle className="size-4" aria-hidden="true" />
          {t('paused')}
        </p>
      ) : (
        <p>{t('notPaused')}</p>
      )}
      {isEmpty(queue.counts) && <p className="text-xs text-muted-foreground">{t('empty')}</p>}
    </div>
  )
}

/** The one-line explanation under a row's name when its state needs one. */
export function useQueueHint(queue: AdminQueue): string | null {
  const t = useTranslations('console.backgroundWork')
  if (queue.status === 'unavailable') return t('unavailableHint')
  if (queue.status === 'disabled') return t('disabledHint')
  return queue.paused ? t('pausedHint') : null
}
