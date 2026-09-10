// init:project --mode=single: primary-unavailable-fallback.tsx. Added by
// P1 item 7 (server-rendered graceful degradation, ADR-079, PR #396) after
// this transform set was last updated -- the plan drifted because a new
// @/i18n/navigation import landed with no matching scaffold step. Import
// order (useRouter before useTranslations) verified empirically (real
// eslint --fix against a disposable copy) rather than guessed -- see
// project-plan-web-nav-links.mjs's header for why that matters here. The
// doc comment's "(locale-aware, via \`@/i18n/navigation\`)" aside is dropped
// since it would be inaccurate once the import changes.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { useRouter } from '@/i18n/navigation'
import type { UnavailableReason } from '@/shared/api/server'

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
   *  copy; every \`reason\` renders the same generic message today (a
   *  deliberate choice, not an oversight - see
   *  \`docs/frontend/server-rendered-resilience.md\`). Never rendered as raw
   *  text to the user. */
  reason: UnavailableReason
  /** Accepted for the same forward-compat reason as \`reason\`. Not rendered:
   *  this starter ships no automatic retry (FINAL PLAN §8), so a countdown
   *  built on it is a downstream product decision, not a default. */
  retryAfterMs?: number
}

/**
 * The localized presentation for a Server Component's known primary
 * \`'unavailable'\` outcome (\`resolvePrimary()\`) - a plain component, **not**
 * an error boundary. Nothing is caught here because nothing was thrown:
 * the caller branches on \`PrimaryRenderOutcome\` directly and renders this
 * in place of the real content.
 *
 * The retry control calls \`router.refresh()\` (locale-aware, via
 * \`@/i18n/navigation\`) to re-run the Server Component tree for the current
 * route - not \`catchError\`'s \`retry()\`, since there is no error boundary in
 * this path to recover from.
 */
export function PrimaryUnavailableFallback({ reason }: PrimaryUnavailableFallbackProps) {
  const t = useTranslations('common')
  const router = useRouter()

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
`

const AFTER = `'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import type { UnavailableReason } from '@/shared/api/server'

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
   *  copy; every \`reason\` renders the same generic message today (a
   *  deliberate choice, not an oversight - see
   *  \`docs/frontend/server-rendered-resilience.md\`). Never rendered as raw
   *  text to the user. */
  reason: UnavailableReason
  /** Accepted for the same forward-compat reason as \`reason\`. Not rendered:
   *  this starter ships no automatic retry (FINAL PLAN §8), so a countdown
   *  built on it is a downstream product decision, not a default. */
  retryAfterMs?: number
}

/**
 * The localized presentation for a Server Component's known primary
 * \`'unavailable'\` outcome (\`resolvePrimary()\`) - a plain component, **not**
 * an error boundary. Nothing is caught here because nothing was thrown:
 * the caller branches on \`PrimaryRenderOutcome\` directly and renders this
 * in place of the real content.
 *
 * The retry control calls \`router.refresh()\` to re-run the Server Component
 * tree for the current route - not \`catchError\`'s \`retry()\`, since there is
 * no error boundary in this path to recover from.
 */
export function PrimaryUnavailableFallback({ reason }: PrimaryUnavailableFallbackProps) {
  const t = useTranslations('common')
  const router = useRouter()

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
`

export function buildWebNavPrimaryFallbackSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/ui/primary-unavailable-fallback.tsx'),
      { expectedBefore: BEFORE, after: AFTER },
      'primary-unavailable-fallback.tsx: drop locale-aware navigation'
    ),
  ]
}
