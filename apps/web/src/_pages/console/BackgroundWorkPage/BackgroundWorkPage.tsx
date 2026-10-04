import { getTranslations } from 'next-intl/server'

import { fetchConsoleQueues } from '@/shared/api/console/queues'
import { resolvePrimary } from '@/shared/api/server'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { QueueSummaryLive } from './QueueSummaryLive'

/**
 * Background work: a read-only view of the queue inventory. The page waits for the first snapshot
 * before returning, so the Console frame's skeleton covers the wait; the heading is part of both the
 * loaded page and the primary-unavailable fallback. A transport failure of that snapshot is the
 * explicit primary-unavailable state; per-queue unavailability is data inside a successful snapshot.
 */
export async function BackgroundWorkPage({
  boardOpenFailed = false,
}: { boardOpenFailed?: boolean } = {}) {
  const t = await getTranslations('console.backgroundWork')
  // Rejected 4xx or malformed 2xx deliberately propagate to the real error boundary.
  const outcome = resolvePrimary(await fetchConsoleQueues(), { source: 'console-queues' })
  return (
    <section className="flex flex-col gap-4">
      <header>
        <p className="font-console-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('scope')}</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('boardPointer')}</p>
      </header>
      {outcome.status === 'unavailable' ? (
        <PrimaryUnavailableFallback reason={outcome.reason} />
      ) : (
        <QueueSummaryLive
          key={outcome.data.checkedAt}
          initial={outcome.data}
          initialUpdatedAt={Date.parse(outcome.data.checkedAt)}
          boardOpenFailed={boardOpenFailed}
        />
      )}
    </section>
  )
}
