import { getFormatter, getTranslations } from 'next-intl/server'

import { fetchConsoleOverview } from '@/shared/api/console/overview'
import { resolvePrimary } from '@/shared/api/server'
import {
  DEPLOYMENT_VERSION,
  deploymentVersionResponseSchema,
} from '@/shared/lib/deployment-version/identity'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { OverviewBody } from './OverviewBody'
import { OverviewWebIdentity } from './OverviewIdentity'
import { OverviewRefresh } from './OverviewRefresh'

export async function OverviewPage() {
  const t = await getTranslations('console')
  const format = await getFormatter()
  // Rejected 4xx or malformed 2xx deliberately propagate to the real error boundary.
  const outcome = resolvePrimary(await fetchConsoleOverview(), { source: 'console-overview' })
  const identity = deploymentVersionResponseSchema.safeParse({ version: DEPLOYMENT_VERSION })
  const artifactId =
    identity.success && identity.data.version !== 'unknown' ? identity.data.version : null
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-console-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            {t('overviewEyebrow')}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('overviewSubtitle')}</p>
          {outcome.status === 'available' && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('overviewEnvironmentLabel')}:{' '}
              {outcome.data.api.environment ?? t('overviewVersionUnknown')}
              {' / '}
              {t('overviewCheckedAt')}:{' '}
              <ConsoleTimestamp value={outcome.data.checkedAt} variant="inline" seconds />
            </p>
          )}
        </div>
        {outcome.status === 'available' && <OverviewRefresh />}
      </header>
      {outcome.status === 'unavailable' ? (
        <>
          <OverviewWebIdentity artifactId={artifactId} t={t} />
          <PrimaryUnavailableFallback reason={outcome.reason} />
        </>
      ) : (
        <OverviewBody overview={outcome.data} artifactId={artifactId} t={t} format={format} />
      )}
    </section>
  )
}
