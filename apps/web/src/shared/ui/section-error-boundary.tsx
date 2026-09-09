'use client'

import { useEffect } from 'react'
import { catchError, type ErrorInfo } from 'next/error'
import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from './button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from './empty'

function UnexpectedSectionErrorFallback(_props: object, { error, retry }: ErrorInfo) {
  const t = useTranslations('common')

  // Dev-console visibility only, matching `(dashboard)/error.tsx`'s existing
  // convention - never read for UI branching. `onRequestError`
  // (`apps/web/src/instrumentation.ts`) already gives the team the
  // server-side, structured record of this same failure.
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>{t('error')}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => retry()}>
          <RefreshCw className="size-4" />
          {t('retry')}
        </Button>
      </EmptyContent>
    </Empty>
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
