import { getTranslations } from 'next-intl/server'

import { ScheduledJobsLive } from '@/features/console-scheduled-jobs'
import { fetchConsoleScheduledJobs } from '@/shared/api/console/scheduled-jobs'
import { resolvePrimary } from '@/shared/api/server'
import { getConsoleBackgroundWorkHref } from '@/shared/lib/console-public-href'
import { ConsoleSourceFocus } from '@/shared/ui/console-detail/ConsoleSourceFocus'
import {
  type ConsoleSourceParams,
  parseConsoleSource,
} from '@/shared/ui/console-detail/parse-console-source'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

/**
 * Scheduled jobs: read-only results that worker processes recorded for the periodic jobs. The page
 * waits for the first snapshot before returning, so the Console frame's skeleton covers the wait; a
 * transport failure of that snapshot is the explicit primary-unavailable state and keeps the heading.
 */
export async function ScheduledJobsPage({
  sourceParams = {},
}: { sourceParams?: ConsoleSourceParams } = {}) {
  const request = parseConsoleSource(sourceParams, 'scheduled')
  const t = await getTranslations('console.scheduledJobs')
  // Rejected 4xx or malformed 2xx deliberately propagate to the real error boundary.
  const outcome = resolvePrimary(await fetchConsoleScheduledJobs(), {
    source: 'console-scheduled-jobs',
  })
  return (
    <section id="console-scheduled-source" className="flex flex-col gap-4">
      <ConsoleSourceFocus
        rootId="console-scheduled-source"
        request={request}
        available={outcome.status === 'available'}
      />
      <header>
        <p className="font-console-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.rich('queuesPointer', {
            link: (chunks) => (
              <RouteProgressLink
                href={getConsoleBackgroundWorkHref()}
                prefetch={false}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {chunks}
              </RouteProgressLink>
            ),
          })}
        </p>
      </header>
      {outcome.status === 'unavailable' ? (
        <PrimaryUnavailableFallback reason={outcome.reason} />
      ) : (
        <ScheduledJobsLive
          key={outcome.data.checkedAt}
          initial={outcome.data}
          initialUpdatedAt={Date.parse(outcome.data.checkedAt)}
        />
      )}
    </section>
  )
}
