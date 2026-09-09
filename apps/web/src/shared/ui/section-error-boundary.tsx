'use client'

import { catchError, type ErrorInfo } from 'next/error'
import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Alert, AlertDescription } from './alert'
import { Button } from './button'

function UnexpectedSectionErrorFallback(_props: object, { retry }: ErrorInfo) {
  const t = useTranslations('common')

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription className="gap-3">
        <span>{t('error')}</span>
        <Button size="sm" onClick={() => retry()}>
          <RefreshCw className="size-4" />
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/**
 * The safety net for a *genuinely unexpected* exception escaping a primary
 * or secondary section - a real bug, never a classified `DataOutcome`
 * (`degradeSecondary()`/`resolvePrimary()` handle those as ordinary render
 * branches and never throw). Wraps any part of the tree:
 *
 * ```tsx
 * <SectionErrorBoundary>
 *   <QueuePanel />
 * </SectionErrorBoundary>
 * ```
 *
 * `retry()` re-fetches and re-renders the boundary's children inside a
 * Transition, recovering Server Component state - the right default here,
 * unlike `reset()` which only clears the error state without re-fetching.
 * The existing route-level `(dashboard)/error.tsx` boundary is not
 * replaced by this - it stays the outermost last-resort net; this
 * component is the granular, in-page one that keeps one section's bug from
 * ever reaching it.
 */
export const SectionErrorBoundary = catchError(UnexpectedSectionErrorFallback)
