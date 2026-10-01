import type { AdminOverviewResponse } from '@amcore/shared'

import type { OverviewFormatter, OverviewTranslations } from './overview-types'

export function OverviewIdentity({
  overview,
  t,
}: {
  overview: AdminOverviewResponse
  t: OverviewTranslations
  format: OverviewFormatter
}) {
  const facts = [
    [t('overviewVersionLabel'), overview.build.version],
    [t('overviewCommitLabel'), overview.build.commit],
    [t('overviewBuildLabel'), overview.build.id],
  ].filter(([, value]) => value !== null)
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md">
      <h3 className="text-lg font-semibold">{t('overviewApiTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('overviewApiSourceHelp')}</p>
      {facts.length ? (
        <dl className="mt-4 space-y-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-console-mono text-sm [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-sm">{t('overviewBuildUnavailable')}</p>
      )}
    </section>
  )
}

export function OverviewWebIdentity({
  artifactId,
  t,
}: {
  artifactId: string | null
  t: OverviewTranslations
}) {
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md">
      <h3 className="text-lg font-semibold">{t('overviewWebTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('overviewWebSourceHelp')}</p>
      {artifactId && (
        <p className="mt-4 font-console-mono text-sm [overflow-wrap:anywhere]">{artifactId}</p>
      )}
    </section>
  )
}
