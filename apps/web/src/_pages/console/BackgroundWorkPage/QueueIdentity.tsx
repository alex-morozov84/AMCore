'use client'

import { useTranslations } from 'next-intl'
import type { AdminQueue } from '@amcore/shared'

import { useQueueHint } from './QueueStatus'

type Part = 'title' | 'description'

/**
 * Human title and purpose of a queue, with its fixed technical name. Copy comes from the message
 * catalogue entry `queues.<technical-name>` when one exists, so a downstream queue gets its own
 * text by adding that entry; otherwise the generic copy of its `kind` is used. Queue names are
 * bounded slugs (no dots), so they are safe as catalogue keys.
 */
export function QueueIdentity({ queue }: { queue: AdminQueue }) {
  const t = useTranslations('console.backgroundWork')
  const hint = useQueueHint(queue)
  // Dynamic keys cannot be checked against the catalogue types; `has` guards each lookup.
  const own = (part: Part) => `queues.${queue.name}.${part}` as 'queues.email.title'
  const text = (part: Part) => (t.has(own(part)) ? t(own(part)) : t(`kinds.${queue.kind}.${part}`))
  return (
    <div>
      <p className="font-medium">{text('title')}</p>
      <p className="font-console-mono text-xs text-muted-foreground">{queue.name}</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{text('description')}</p>
      {hint && <p className="mt-1 text-sm">{hint}</p>}
    </div>
  )
}
