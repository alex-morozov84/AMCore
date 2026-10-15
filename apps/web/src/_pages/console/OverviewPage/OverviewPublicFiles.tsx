import type { AdminOverviewPublicDelivery } from '@amcore/shared'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import type { OverviewTranslations } from './overview-types'

const OFF_REASONS = {
  local_driver: 'overviewPublicOffLocal',
  memory_driver: 'overviewPublicOffMemory',
  disabled: 'overviewPublicOffDisabled',
  worker_process: 'overviewPublicOffWorker',
} as const
const DELIVERY = {
  external: 'overviewPublicDeliveryExternal',
  acl: 'overviewPublicDeliveryAcl',
  api: 'overviewPublicDeliveryApi',
} as const
const NOT_SERVED_HINT = {
  external: 'overviewPublicHintExternal',
  acl: 'overviewPublicHintAcl',
  api: 'overviewPublicHintApi',
} as const
const FAILURES = {
  public_unreachable: 'overviewPublicUnreachable',
  content_mismatch: 'overviewPublicMismatch',
  check_error: 'overviewPublicCheckError',
  timeout: 'overviewPublicTimeout',
} as const

/** The failure that means private data is reachable anonymously, not merely a broken setup. */
export function isPrivateExposed(check: AdminOverviewPublicDelivery): boolean {
  return check.failure === 'private_exposed'
}

/** Prominent, deliberately unlike an ordinary warning: this is a data-exposure incident. */
export function OverviewExposureBanner({
  check,
  t,
}: {
  check: AdminOverviewPublicDelivery
  t: OverviewTranslations
}) {
  if (!isPrivateExposed(check)) return null
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle className="font-semibold">{t('overviewPublicExposedTitle')}</AlertTitle>
      <AlertDescription>
        <p>
          {t(
            check.stage === 'private_exposed_base'
              ? 'overviewPublicExposedBase'
              : 'overviewPublicExposedApi'
          )}
        </p>
        <p className="mt-1">{t('overviewPublicExposedAction')}</p>
      </AlertDescription>
    </Alert>
  )
}

/** Driver-independent configuration an operator needs; never buckets, endpoints or credentials. */
export function OverviewPublicConfig({
  check,
  t,
}: {
  check: AdminOverviewPublicDelivery
  t: OverviewTranslations
}) {
  const values = {
    delivery: t(DELIVERY[check.delivery]),
    layout: t(check.layout === 'one' ? 'overviewPublicLayoutOne' : 'overviewPublicLayoutTwo'),
  }
  return (
    <p className="mt-1 text-sm text-muted-foreground break-words">
      {check.publicBaseUrl
        ? t('overviewPublicConfig', { ...values, url: check.publicBaseUrl })
        : t('overviewPublicConfigNoUrl', values)}
    </p>
  )
}

function stateLabel(check: AdminOverviewPublicDelivery, t: OverviewTranslations): string {
  if (check.state === 'healthy') return t('overviewPublicServed')
  if (check.state === 'unknown') return t('overviewFilesUnknown')
  if (check.state === 'stale') return t('overviewFilesStale')
  if (check.state === 'off') return t('overviewPublicOff')
  return t(isPrivateExposed(check) ? 'overviewPublicExposed' : 'overviewPublicNotServed')
}

function detail(check: AdminOverviewPublicDelivery, t: OverviewTranslations): string | null {
  if (check.state === 'off' && check.offReason) return t(OFF_REASONS[check.offReason])
  if (check.state !== 'failed' || !check.failure || check.failure === 'private_exposed') return null
  if (check.failure === 'public_not_served') return t(NOT_SERVED_HINT[check.delivery])
  return t(FAILURES[check.failure])
}

/** The right-hand side of the "Public files" row: result, time of the check and what to do. */
export function OverviewPublicState({
  check,
  t,
}: {
  check: AdminOverviewPublicDelivery
  t: OverviewTranslations
}) {
  const hint = detail(check, t)
  const tone =
    check.state === 'healthy'
      ? 'text-success'
      : check.state === 'off'
        ? 'text-muted-foreground'
        : isPrivateExposed(check)
          ? 'font-semibold text-destructive'
          : 'text-warning'
  return (
    <div className="space-y-1 text-sm sm:text-right">
      <p className={tone}>{stateLabel(check, t)}</p>
      {check.state !== 'off' && (
        <p>
          {t('overviewFilesLastCheck')}:{' '}
          {check.checkedAt ? (
            <ConsoleTimestamp value={check.checkedAt} variant="inline" seconds />
          ) : (
            t('overviewFilesUnmeasured')
          )}
        </p>
      )}
      {hint && <p className="max-w-prose text-muted-foreground sm:ml-auto">{hint}</p>}
    </div>
  )
}
