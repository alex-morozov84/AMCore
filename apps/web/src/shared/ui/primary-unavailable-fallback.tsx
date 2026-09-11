'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import type { UnavailableReason } from '@/shared/api/server'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import { Alert, AlertDescription } from './alert'
import { Button } from './button'

const MESSAGE_KEYS = {
  'rate-limited': 'temporarilyUnavailable',
  timeout: 'temporarilyUnavailable',
  network: 'temporarilyUnavailable',
  upstream: 'temporarilyUnavailable',
} as const satisfies Record<UnavailableReason, 'temporarilyUnavailable'>

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
 * The retry control calls `router.refresh()` (via
 * `useRouteProgressRouter()`, which passes `refresh()` straight through
 * unstarted) to re-run the Server Component tree for the current route -
 * not `catchError`'s `retry()`, since there is no error boundary in this
 * path to recover from.
 */
export function PrimaryUnavailableFallback({ reason }: PrimaryUnavailableFallbackProps) {
  const t = useTranslations('common')
  const router = useRouteProgressRouter()

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription className="gap-3">
        <span>{t(MESSAGE_KEYS[reason])}</span>
        <Button size="sm" onClick={() => router.refresh()}>
          <RefreshCw className="size-4" />
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
