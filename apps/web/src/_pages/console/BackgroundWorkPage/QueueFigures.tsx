'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueue } from '@amcore/shared'

import { ageParts, queuedCount } from './queue-copy'

type Available = Extract<AdminQueue, { status: 'available' }>

/** Counts of an available row; `—` (never 0) for unavailable or disabled rows. */
export function useQueueFigures(queue: AdminQueue) {
  const t = useTranslations('console.backgroundWork')
  if (queue.status !== 'available') {
    const none = t('noFigure')
    return { waiting: none, active: none, delayed: none, failed: none }
  }
  const { counts } = queue
  return {
    waiting: String(queuedCount(counts)),
    active: String(counts.active),
    delayed: String(counts.delayed),
    failed: String(counts.failed),
  }
}

export function QueueAge({ queue }: { queue: AdminQueue }) {
  const t = useTranslations('console.backgroundWork')
  if (queue.status !== 'available') return <>{t('noFigure')}</>
  return <>{ageText(queue, t)}</>
}

function ageText(queue: Available, t: ReturnType<typeof useTranslations>) {
  const { age } = queue
  if (age.status === 'none') return t('ageNone')
  if (age.status === 'unknown') return t('ageUnknown')
  const { unit, n } = ageParts(age.seconds)
  return t('ageAtLeast', { age: t(unit, { n }) })
}
