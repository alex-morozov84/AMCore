import { CircleHelp, Pause, TriangleAlert } from 'lucide-react'

import { docsPageHref } from '@/shared/lib/console-docs-links'
import { consoleMetricsHref } from '@/shared/lib/console-metrics-link'
import { getConsoleIntegrationsHref } from '@/shared/lib/console-public-href'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { Disclosure } from '@/shared/ui/disclosure'
import { NewTabLink } from '@/shared/ui/new-tab-link'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { OverviewProblem, ProblemCopy, ProblemSource } from './overview-problem-model'
import type { OverviewProblems as Model } from './overview-problems'

type Props = { model: Model; t: ProblemCopy; metrics: string | null; newTabLabel: string }
export function OverviewProblems({ model, ...copy }: Props) {
  const { t } = copy
  const groups = Map.groupBy(model.gaps, (entry) => entry.source)
  return (
    <Card aria-labelledby="overview-attention-title">
      <CardHeader>
        <CardTitle as="h2" id="overview-attention-title">
          {t('title')}
        </CardTitle>
        <CardDescription>{t('intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {model.attention.length ? (
          <>
            <ul className="divide-y">
              {model.attention.slice(0, 5).map((entry) => (
                <ProblemItem key={entry.key} entry={entry} {...copy} />
              ))}
            </ul>
            {model.attention.length > 5 && (
              <Disclosure label={t('more', { count: model.attention.length - 5 })}>
                <ul className="divide-y">
                  {model.attention.slice(5).map((entry) => (
                    <ProblemItem key={entry.key} entry={entry} {...copy} />
                  ))}
                </ul>
              </Disclosure>
            )}
          </>
        ) : (
          <p className="text-sm">
            {t(model.allUnavailable ? 'unavailable' : model.gaps.length ? 'partialEmpty' : 'empty')}
          </p>
        )}
        {groups.size > 0 && (
          <section aria-labelledby="overview-coverage-title" className="space-y-3 border-t pt-4">
            <h3 id="overview-coverage-title" className="font-medium">
              {t('gaps')}
            </h3>
            {[...groups].map(([source, entries]) => (
              <CoverageGroup key={source} source={source} entries={entries} {...copy} />
            ))}
          </section>
        )}
        {model.limitations && (
          <p className="text-xs text-muted-foreground">
            {t('limits')}{' '}
            <RouteProgressLink
              prefetch={false}
              href={getConsoleIntegrationsHref()}
              className="underline"
            >
              {t('openIntegration')}
            </RouteProgressLink>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
function CoverageGroup({
  source,
  entries,
  ...copy
}: Omit<Props, 'model'> & { source: ProblemSource; entries: OverviewProblem[] }) {
  const rows = (
    <ul className="divide-y">
      {entries.map((entry) => (
        <ProblemItem key={entry.key} entry={entry} coverage {...copy} />
      ))}
    </ul>
  )
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{copy.t(source)}</p>
      {entries.length === 1 ? (
        rows
      ) : (
        <Disclosure label={copy.t('gapCount', { count: entries.length })}>{rows}</Disclosure>
      )}
    </div>
  )
}
function ProblemItem({
  entry,
  t,
  metrics,
  newTabLabel,
  coverage = false,
}: Omit<Props, 'model'> & { entry: OverviewProblem; coverage?: boolean }) {
  const Icon =
    entry.priority === null || entry.priority === 3
      ? CircleHelp
      : entry.priority === 4
        ? Pause
        : TriangleAlert
  const tone =
    entry.priority === 0 || entry.priority === 1
      ? 'text-danger'
      : entry.priority === 2
        ? 'text-warning'
        : 'text-muted-foreground'
  const Heading = coverage ? 'h4' : 'h3'
  const metricHref = consoleMetricsHref(metrics, entry.metricAt)
  const [guidePath, anchor] = entry.guide.split('#')
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <Heading className="flex items-start gap-2 font-medium break-words">
        <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} />
        <span className="min-w-0 break-words">{entry.name}</span>
      </Heading>
      {entry.technicalId && (
        <p className="font-console-mono text-xs text-muted-foreground break-all">
          {entry.technicalId}
        </p>
      )}
      <div className="space-y-1 text-sm">
        {entry.facts.map((fact, i) => (
          <div key={i}>
            {fact.text && <p>{fact.text}</p>}
            {fact.time && (
              <p className="text-xs text-muted-foreground">
                {fact.at ? (
                  <>
                    {t(fact.time)}: <ConsoleTimestamp value={fact.at} variant="inline" seconds />
                  </>
                ) : (
                  t('unknownTime')
                )}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <RouteProgressLink
          href={entry.href}
          prefetch={false}
          className="underline underline-offset-4"
        >
          {t(entry.action)}
        </RouteProgressLink>
        <NewTabLink
          href={docsPageHref(guidePath!, anchor)}
          newTabLabel={newTabLabel}
          className="underline underline-offset-4"
        >
          {t('guide')}
        </NewTabLink>
        {metricHref && (
          <NewTabLink
            href={metricHref}
            newTabLabel={newTabLabel}
            className="underline underline-offset-4"
          >
            {t('metrics')}
          </NewTabLink>
        )}
      </div>
    </li>
  )
}
