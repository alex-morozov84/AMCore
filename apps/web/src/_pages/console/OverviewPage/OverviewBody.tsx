import type { AdminOverviewResponse } from '@amcore/shared'

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'

import type { OverviewFormatter, OverviewTranslations } from './overview-types'
import { OverviewDetails } from './OverviewDetails'
import { OverviewIdentity, OverviewWebIdentity } from './OverviewIdentity'
import { OverviewResources } from './OverviewResources'

export function OverviewBody({
  overview,
  artifactId,
  t,
  format,
}: {
  overview: AdminOverviewResponse
  artifactId: string | null
  t: OverviewTranslations
  format: OverviewFormatter
}) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <OverviewIdentity overview={overview} t={t} format={format} />
        <OverviewWebIdentity artifactId={artifactId} t={t} />
      </div>
      <p className="text-sm text-muted-foreground">{t('overviewIndependentSamplesHelp')}</p>
      <OverviewResources overview={overview} t={t} format={format} />
      {overview.readiness !== 'ready' && (
        <Alert variant={overview.readiness === 'not_ready' ? 'destructive' : 'default'}>
          <AlertTitle>
            {t(
              overview.readiness === 'not_ready'
                ? 'overviewNotReadyTitle'
                : 'overviewDependencyStatusDegraded'
            )}
          </AlertTitle>
          <AlertDescription>
            {t(
              overview.readiness === 'not_ready' ? 'overviewNotReadyHelp' : 'overviewDegradedNotice'
            )}
          </AlertDescription>
        </Alert>
      )}
      <OverviewDetails overview={overview} t={t} />
    </>
  )
}
