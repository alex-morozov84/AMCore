'use client'
import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'

import type { SaveResult } from '../model/use-role-editor'

/** One live region for the outcome of the last save and the unsaved/stale state of the draft. */
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
    <div className="space-y-2">
      <p>{message}</p>
      <Button type="button" variant="outline" onClick={onReview}>
        {t('reviewCurrent')}
      </Button>
    </div>
  )
  let content = null
  if (result.kind === 'saved')
    content = <p>{result.accessChanged ? t('savedAccessChanged') : t('saved')}</p>
  else if (result.kind === 'conflict' || stale) content = review(t('conflict'))
  else if (result.kind === 'unknown') content = review(t('saveUnknown'))
  else if (result.kind === 'busy') content = <p>{t('createBusy')}</p>
  else if (dirty) content = <p>{t('unsaved')}</p>
  return (
    <div role="status" aria-live="polite">
      {content}
    </div>
  )
}
