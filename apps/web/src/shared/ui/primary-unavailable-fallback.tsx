'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { useRouter } from '@/i18n/navigation'
import type { UnavailableReason } from '@/shared/api/server'

import { Button } from './button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from './empty'

export interface PrimaryUnavailableFallbackProps {
  /** Accepted for a stable call-site contract and possible future per-reason
   *  copy; every `reason` renders the same generic message today (a
   *  deliberate choice, not an oversight - see
   *  `docs/frontend/server-rendered-resilience.md`). Never rendered as raw
   *  text to the user. */
  reason: UnavailableReason
  /** Accepted for the same forward-compat reason as `reason`. Not rendered:
   *  this starter ships no automatic retry (FINAL PLAN §8), so a countdown
   *  built on it is a downstream product decision, not a default. */
  retryAfterMs?: number
}

/**
 * The localized presentation for a Server Component's known primary
 * `'unavailable'` outcome (`resolvePrimary()`) - a plain component, **not**
 * an error boundary. Nothing is caught here because nothing was thrown:
 * the caller branches on `PrimaryRenderOutcome` directly and renders this
 * in place of the real content.
 *
 * The retry control calls `router.refresh()` (locale-aware, via
 * `@/i18n/navigation`) to re-run the Server Component tree for the current
 * route - not `catchError`'s `retry()`, since there is no error boundary in
 * this path to recover from.
 */
export function PrimaryUnavailableFallback({ reason }: PrimaryUnavailableFallbackProps) {
  const t = useTranslations('common')
  const router = useRouter()

  return (
    <Empty data-reason={reason}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>{t('temporarilyUnavailable')}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => router.refresh()}>
          <RefreshCw className="size-4" />
          {t('retry')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
