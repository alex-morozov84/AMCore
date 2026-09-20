import { getTranslations } from 'next-intl/server'

import { fetchConsoleOverview } from '@/shared/api/console/overview'
import { resolvePrimary } from '@/shared/api/server'
import { cn } from '@/shared/lib/utils'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { OverviewDetails } from './OverviewDetails'
import { OverviewNotReadyAlert } from './OverviewNotReadyAlert'

const MONO = 'font-console-mono'

/**
 * Console Overview: this API instance's readiness, dependency states,
 * version and process role only — no Queues/Recent Activity content (a
 * later, separate backlog item regardless of what the pinned design
 * reference shows on one screen).
 */
export async function OverviewPage() {
  const t = await getTranslations('console')
  const outcome = resolvePrimary(await fetchConsoleOverview(), { source: 'console-overview' })

  if (outcome.status === 'unavailable') {
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  }

  const overview = outcome.data

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className={cn(MONO, 'text-xs tracking-[0.2em] text-foreground-muted uppercase')}>
          {t('overviewEyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-foreground-muted">{t('overviewSubtitle')}</p>
      </div>

      {overview.readiness === 'not_ready' && (
        <OverviewNotReadyAlert dependencies={overview.dependencies} />
      )}

      <OverviewDetails overview={overview} t={t} />
    </section>
  )
}
