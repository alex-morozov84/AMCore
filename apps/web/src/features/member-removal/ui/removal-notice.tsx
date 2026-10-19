'use client'
import { useTranslations } from 'next-intl'
import { CheckCircle2, CircleAlert, Info } from 'lucide-react'

import type { MemberRemovalTarget, useMemberRemoval } from '@/entities/organization-context'
import { getErrorCode, getErrorStatus } from '@/shared/api/errors'
import { useApiError } from '@/shared/api/use-api-error'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button, buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

type Removal = ReturnType<typeof useMemberRemoval>
export function RemovalNotice({
  removal,
  target,
  self,
  organizationsHref,
  onReview,
}: {
  removal: Removal
  target: MemberRemovalTarget
  self: boolean
  organizationsHref?: string
  onReview: () => void
}) {
  const t = useTranslations('memberRemoval')
  const describe = useApiError()
  const outcome = removal.outcome
  if (!removal.pending && !outcome) return null
  const error = outcome && 'error' in outcome ? outcome.error : undefined
  const lastAdmin =
    getErrorStatus(error) === 400 && getErrorCode(error) === 'BUSINESS_RULE_VIOLATION'
  const limit = getErrorStatus(error) === 409 && getErrorCode(error) === 'MEMBER_API_KEYS_LIMIT'
  const committed = outcome?.status === 'committed'
  const unknown = outcome?.status === 'unknown'
  const rejected = outcome?.status === 'rejected'
  const title = removal.pending
    ? 'pending'
    : committed
      ? self
        ? 'selfSuccessTitle'
        : 'successTitle'
      : unknown
        ? 'unknownTitle'
        : lastAdmin
          ? 'lastAdminTitle'
          : limit
            ? 'limitTitle'
            : 'rejectedTitle'
  const failure = rejected && !lastAdmin && !limit ? describe(error) : undefined
  return (
    <div className="space-y-3" data-testid="member-removal-notice">
      <Alert
        role={rejected ? 'alert' : 'status'}
        variant={unknown || lastAdmin || limit ? 'warning' : rejected ? 'destructive' : 'default'}
      >
        {committed ? <CheckCircle2 /> : unknown || rejected ? <CircleAlert /> : <Info />}
        <AlertTitle className="line-clamp-none break-words">{t(title)}</AlertTitle>
        <AlertDescription className="gap-3">
          {!self || !committed ? (
            <p className="break-all">
              {target.name
                ? t('memberIdentity', { name: target.name, email: target.email })
                : target.email}
            </p>
          ) : null}
          {committed && <p>{t(self ? 'selfSuccess' : 'success')}</p>}
          {committed &&
            outcome.followup !== 'ready' &&
            !(self && outcome.followup === 'denied') && <p>{t('refreshFailed')}</p>}
          {unknown && <p>{t('unknown')}</p>}
          {lastAdmin && <p>{t('lastAdmin')}</p>}
          {limit && <p>{t('limit')}</p>}
          {failure && <p>{failure.message}</p>}
          {failure?.isUnknown && failure.correlationId && (
            <p className="break-all text-xs">{failure.correlationId}</p>
          )}
          {unknown && removal.inspection && <p>{t(removal.inspection.status)}</p>}
          {unknown && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={removal.checking || removal.busy || Boolean(removal.retryAt)}
                onClick={() => void removal.inspect()}
              >
                {t('check')}
              </Button>
              {removal.inspection?.status === 'same' && removal.canRemove && (
                <Button variant="outline" onClick={onReview}>
                  {t('review')}
                </Button>
              )}
            </div>
          )}
          {committed && self && organizationsHref && (
            <div className="flex flex-wrap gap-2">
              <RouteProgressLink
                href={organizationsHref}
                className={buttonVariants({ variant: 'outline' })}
              >
                {t('organizations')}
              </RouteProgressLink>
            </div>
          )}
        </AlertDescription>
      </Alert>
      {unknown && removal.inspection?.status === 'error' && (
        <ApiErrorAlert error={removal.inspection.error} />
      )}
    </div>
  )
}
