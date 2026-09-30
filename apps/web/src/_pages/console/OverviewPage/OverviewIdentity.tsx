import type { AdminOverviewResponse } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import type { OverviewFormatter, OverviewTranslations } from './overview-types'

const ROLES = {
  all: 'overviewProcessRoleAll',
  web: 'overviewProcessRoleWeb',
  worker: 'overviewProcessRoleWorker',
} as const

export function OverviewIdentity({
  overview,
  t,
  format,
}: {
  overview: AdminOverviewResponse
  t: OverviewTranslations
  format: OverviewFormatter
}) {
  const unknown = t('overviewVersionUnknown')
  const facts = [
    [t('overviewVersionLabel'), overview.api.version ?? unknown],
    [t('overviewCommitLabel'), overview.api.commit ?? unknown],
    [t('overviewDeploymentLabel'), overview.api.deploymentId ?? unknown],
    [t('overviewRuntimeModeLabel'), t(`overviewRuntimeMode${overview.api.runtimeMode}`)],
    [t('overviewInstanceLabel'), overview.process.instanceId],
    [t('overviewProcessRoleLabel'), t(ROLES[overview.processRole])],
    [
      t('overviewUptimeLabel'),
      t('overviewSeconds', {
        value: format.number(overview.process.uptimeSeconds, { maximumFractionDigits: 0 }),
      }),
    ],
  ]
  return (
    <section
      className="rounded-lg border bg-surface-elevated p-6 shadow-md"
      aria-label={t('overviewApiTitle')}
    >
      <h2 className="text-lg font-semibold">{t('overviewApiTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('overviewApiSourceHelp')}</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-console-mono text-sm [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-muted-foreground">{t('overviewSampledAt')}</dt>
          <dd className="mt-1 text-sm">
            <ConsoleTimestamp value={overview.process.sampledAt} variant="inline" seconds />
          </dd>
        </div>
      </dl>
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
    <section
      className="rounded-lg border bg-surface-elevated p-6 shadow-md"
      aria-label={t('overviewWebTitle')}
    >
      <h2 className="text-lg font-semibold">{t('overviewWebTitle')}</h2>
      <dl className="mt-4">
        <dt className="text-xs text-muted-foreground">{t('overviewWebArtifactLabel')}</dt>
        <dd className="mt-1 font-console-mono text-sm [overflow-wrap:anywhere]">
          {artifactId ?? t('overviewVersionUnknown')}
        </dd>
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">{t('overviewWebSourceHelp')}</p>
    </section>
  )
}
