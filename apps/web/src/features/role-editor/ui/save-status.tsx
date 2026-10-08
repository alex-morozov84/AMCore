'use client'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

import type { SaveResult } from '../model/use-role-editor'

/** What the person must know before saving again; shown in the action bar so it cannot be missed. */
export function SaveStatus({
  result,
  stale,
  dirty,
  onReview,
}: {
  result: SaveResult
  stale: boolean
  dirty: boolean
  onReview: () => void
}) {
  const t = useTranslations('organizationRoles')
  const review = (message: string) => (
    <Alert variant="warning">
      <AlertDescription className="gap-3">
        <p className="font-medium text-card-foreground">{message}</p>
        <Button type="button" variant="outline" size="sm" onClick={onReview}>
          {t('reviewCurrent')}
        </Button>
      </AlertDescription>
    </Alert>
  )
  if (result.kind === 'rejected') return <ApiErrorAlert error={result.error} />
  if (result.kind === 'conflict' || stale) return review(t('conflict'))
  if (result.kind === 'unknown') return review(t('saveUnknown'))
  if (result.kind === 'busy') return <p role="status">{t('createBusy')}</p>
  if (dirty)
    return (
      <p role="status" className="text-sm font-medium">
        {t('unsaved')}
      </p>
    )
  return null
}
