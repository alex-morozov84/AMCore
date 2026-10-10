import { getTranslations } from 'next-intl/server'

import { BackgroundWorkControls } from '@/features/console-background-work'
import { fetchConsoleBackgroundWork } from '@/shared/api/console/background-work'
import { fetchConsoleQueues } from '@/shared/api/console/queues'
import { resolvePrimary } from '@/shared/api/server'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { QueueSummaryLive } from './QueueSummaryLive'

/**
 * Background work: registration-driven controls and read-only queue/Board observation.
 * The page waits for the first snapshot
 * before returning, so the Console frame's skeleton covers the wait; the heading is part of both the
 * loaded page and the primary-unavailable fallback. A transport failure of that snapshot is the
 * explicit primary-unavailable state; per-queue unavailability is data inside a successful snapshot.
 */
export async function BackgroundWorkPage({
  boardOpenFailed = false,
}: { boardOpenFailed?: boolean } = {}) {
  const t = await getTranslations('console.backgroundWork')
  // Rejected 4xx or malformed 2xx deliberately propagate to the real error boundary.
  const [queues, registered] = await Promise.all([
    fetchConsoleQueues(),
    fetchConsoleBackgroundWork(),
  ])
  const outcome = resolvePrimary(queues, { source: 'console-queues' })
  const work = resolvePrimary(registered, { source: 'console-background-work' })
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
        <>
          <PrimaryUnavailableFallback reason={outcome.reason} />
          {work.status === 'available' ? (
            <BackgroundWorkControls initial={work.data} />
          ) : (
            <PrimaryUnavailableFallback reason={work.reason} />
          )}
        </>
      ) : (
        <QueueSummaryLive
          key={outcome.data.checkedAt}
          initial={outcome.data}
          initialWork={work.status === 'available' ? work.data : []}
          workUnavailable={work.status === 'unavailable' ? work.reason : undefined}
          initialUpdatedAt={Date.parse(outcome.data.checkedAt)}
          boardOpenFailed={boardOpenFailed}
        />
      )}
    </section>
  )
}
