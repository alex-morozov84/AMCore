'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueue } from '@amcore/shared'

import { isKnownQueue } from './queue-copy'
import { useQueueHint } from './QueueStatus'

/** Human title and purpose of a queue, with its fixed technical name; unknown names fall back by kind. */
export function QueueIdentity({ queue }: { queue: AdminQueue }) {
  const t = useTranslations('console.backgroundWork')
  const hint = useQueueHint(queue)
  const known = isKnownQueue(queue.name) ? queue.name : null
  return (
    <div>
      <p className="font-medium">
        {known ? t(`queues.${known}.title`) : t(`kinds.${queue.kind}.title`)}
      </p>
      <p className="font-console-mono text-xs text-muted-foreground">{queue.name}</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {known ? t(`queues.${known}.description`) : t(`kinds.${queue.kind}.description`)}
      </p>
      {hint && <p className="mt-1 text-sm">{hint}</p>}
    </div>
  )
}
