import { getFormatter, getLocale, getTranslations } from 'next-intl/server'

import { getConsoleExternalLinks } from '@/shared/lib/console-external-links'
import { getConsoleLogSearchTarget } from '@/shared/lib/console-log-search-target'
import { getConsoleMetricsTarget } from '@/shared/lib/console-metrics-target'
import {
  DEPLOYMENT_VERSION,
  deploymentVersionResponseSchema,
} from '@/shared/lib/deployment-version/identity'

import { DEPENDENCY_LABEL_KEY } from './overview-dependency-labels'
import { overviewProblems } from './overview-problems'
import { readOverviewSources } from './overview-sources'
import { OverviewBody } from './OverviewBody'
import { OverviewExternalTools } from './OverviewExternalTools'
import { OverviewWebIdentity } from './OverviewIdentity'
import { OverviewProblems } from './OverviewProblems'
import { OverviewRefresh } from './OverviewRefresh'

export async function OverviewPage() {
  const [t, copy, locale, format, snapshot] = await Promise.all([
    getTranslations('console'),
    getTranslations('console.problems'),
    getLocale(),
    getFormatter(),
    readOverviewSources(),
  ])
  const model = overviewProblems(snapshot.sources, {
    t: copy,
    locale,
    name: (kind, id, fallback) => {
      if (kind === 'dependency') {
        const key = DEPENDENCY_LABEL_KEY[id as keyof typeof DEPENDENCY_LABEL_KEY]
        return key ? t(key) : fallback
      }
      const path =
        `${kind === 'job' ? 'scheduledJobs.jobs' : 'integrations.names'}.${id}${kind === 'job' ? '.name' : ''}` as Parameters<
          typeof t.has
        >[0]
      return t.has(path) ? t(path) : fallback
    },
  })
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
        </div>
        <OverviewRefresh retryAfterMs={snapshot.retryAfterMs} renderId={snapshot.renderId} />
      </header>
      <OverviewProblems
        model={model}
        t={copy}
        metrics={getConsoleMetricsTarget()}
        newTabLabel={t('overviewPublicOpenNewTab')}
      />
      <OverviewExternalTools
        links={getConsoleExternalLinks()}
        logSearchConfigured={getConsoleLogSearchTarget() !== null}
        t={t}
      />
      {snapshot.sources.overview ? (
        <OverviewBody
          overview={snapshot.sources.overview}
          artifactId={artifactId}
          t={t}
          format={format}
        />
      ) : (
        <OverviewWebIdentity artifactId={artifactId} t={t} />
      )}
    </section>
  )
}
