'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { useInvitationManagerOperations } from '@/entities/organization-context'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

type Operation = ReturnType<typeof useInvitationManagerOperations>
export function InvitationOperationStatus({ operation }: { operation: Operation }) {
  const t = useTranslations('organizationInvitations')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<unknown>()
  const [expiredRetryAt, setExpiredRetryAt] = useState<number>()
  useEffect(() => {
    if (!operation.retryAt) return
    const timer = setTimeout(
      () => setExpiredRetryAt(operation.retryAt),
      Math.max(0, operation.retryAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [operation.retryAt])
  if (operation.status === 'idle' || operation.status === 'retired') return null
  const recoveryDisabled = operation.retryAt !== undefined && expiredRetryAt !== operation.retryAt
  async function review() {
    setReviewing(true)
    setReviewError(undefined)
    try {
      if (!(await operation.controller.review())) setReviewError(new Error('AUTHORITY_UNAVAILABLE'))
    } catch (error) {
      setReviewError(error)
    } finally {
      setReviewing(false)
    }
  }
  const label =
    operation.status === 'committed'
      ? operation.result?.status === 'revoked'
        ? 'revokedProcessed'
        : 'processed'
      : operation.status === 'pending'
        ? 'processing'
        : operation.status === 'unknown'
          ? 'unknownOutcome'
          : operation.status === 'expired'
            ? 'expiredOutcome'
            : 'rejected'
  return (
    <div className="space-y-3">
      <Alert>
        <AlertDescription role="status">{t(label)}</AlertDescription>
      </Alert>
      {!operation.persistent && (
        <p className="text-sm text-muted-foreground">{t('storageUnavailable')}</p>
      )}
      {operation.status === 'committed' && operation.followup !== 'ready' && (
        <p className="text-sm">{t('refreshFailed')}</p>
      )}
      <ApiErrorAlert error={operation.error ?? reviewError} />
      {operation.status === 'unknown' && (
        <Button
          variant="outline"
          disabled={recoveryDisabled}
          onClick={() => {
            void operation.controller.recover()
          }}
        >
          {t('recover')}
        </Button>
      )}
      {(['rejected', 'expired'].includes(operation.status) ||
        (operation.status === 'committed' && operation.followup !== 'ready')) && (
        <Button
          variant="outline"
          disabled={reviewing || recoveryDisabled}
          onClick={() => {
            void review()
          }}
        >
          {t('reviewCurrent')}
        </Button>
      )}
    </div>
  )
}
