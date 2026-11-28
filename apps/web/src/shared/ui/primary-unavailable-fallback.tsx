'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import type { UnavailableReason } from '@/shared/api/server'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import { Alert, AlertDescription } from './alert'
import { Button } from './button'

export interface PrimaryUnavailableFallbackProps {
  reason: UnavailableReason
  retryAfterMs?: number
  /**
   * Overrides the default `router.refresh()` retry action. `router.refresh()`
   * re-runs a Server Component tree; it does not refetch a client-side
   * TanStack Query, so a client interactive leaf using this same
   * presentation for a failed Query passes its own `refetch` here instead.
   * Server-rendered call sites omit this and keep the original behavior.
   */
  onRetry?: () => void
}

/**
 * The localized presentation for a Server Component's known primary
 * `'unavailable'` outcome (`resolvePrimary()`) - a plain component, **not**
 * an error boundary. Nothing is caught here because nothing was thrown:
 * the caller branches on `PrimaryRenderOutcome` directly and renders this
 * in place of the real content.
 *
 * The retry control calls `router.refresh()` (via
 * `useRouteProgressRouter()`, which passes `refresh()` straight through
 * unstarted) to re-run the Server Component tree for the current route -
 * not `catchError`'s `retry()`, since there is no error boundary in this
 * path to recover from.
 */
export function PrimaryUnavailableFallback({
  reason,
  retryAfterMs,
  onRetry,
}: PrimaryUnavailableFallbackProps) {
  const t = useTranslations('common')
  const router = useRouteProgressRouter()

  const rateLimited = reason === 'rate-limited'
  const message = rateLimited ? t('rateLimitReason') : t('temporarilyUnavailable')
  const wait =
    rateLimited && retryAfterMs !== undefined && retryAfterMs > 0 && Number.isFinite(retryAfterMs)
      ? t('rateLimitWait', { seconds: Math.ceil(retryAfterMs / 1000) })
      : undefined

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription className="gap-3">
        <span>
          {message}
          {wait && ` ${wait}`}
        </span>
        <Button size="sm" onClick={onRetry ?? (() => router.refresh())}>
          <RefreshCw className="size-4" />
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
