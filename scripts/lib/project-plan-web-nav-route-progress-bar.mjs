// init:project --mode=single: route-progress-bar.tsx (P1 item 8). Merges
// usePathname into the existing next/navigation useSearchParams import --
// single-locale mode has no [locale] segment, so usePathname() needs no
// locale awareness. Import order verified empirically (eslint --fix
// against a disposable copy), not guessed. Before text lives in
// project-plan-web-nav-route-progress-bar-before.mjs (line-count guidance).
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'
import { ROUTE_PROGRESS_BAR_BEFORE } from './project-plan-web-nav-route-progress-bar-before.mjs'

const AFTER = `'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import {
  type RouteProgressController,
  routeProgressController,
} from '@/shared/lib/route-progress/route-progress-controller'

import styles from './route-progress-bar.module.css'

/**
 * Canonical \`pathname[?query]\` key, with no trailing \`?\` for an empty query
 * -- \`usePathname()\`/\`useSearchParams()\` and \`window.location\` disagree on
 * that formatting (\`location.search\` is \`''\` for no query, \`URLSearchParams
 * #toString()\` also \`''\`, but naively concatenating a literal \`?\` between
 * them does not), so every comparison in this file goes through here rather
 * than each building its own ad hoc string.
 */
function toLocationKey(pathname: string, search: string): string {
  return search ? \`\${pathname}?\${search}\` : pathname
}

export interface RouteProgressBarProps {
  /** Escape hatch for isolated rendering (Storybook, tests) -- the real app
   *  never passes this, always the module singleton default. */
  controller?: RouteProgressController
}

/**
 * Global top route-progress bar. Mounted once, gated by
 * \`ROUTE_PROGRESS_ENABLED\`, in the Server Component root layout inside a
 * \`<Suspense>\` (it reads \`useSearchParams()\`). Purely decorative -- \`aria-
 * hidden\`, Next's own route announcer owns the accessible navigation
 * announcement.
 *
 * \`<Link>\` clicks no longer start the bar from here -- reconverged FINAL
 * PLAN item 5 (2026-09-10, Agent 2 diff review): a \`document\`-level click
 * listener cannot tell an application's own cancelled navigation apart from
 * Next's own unconditional \`preventDefault()\` inside \`<Link>\`'s click
 * handler, so a genuinely cancelled Link click still started the bar and
 * then stranded it until \`maxDurationMs\`'s safety net. \`RouteProgressLink\`
 * (\`@/shared/ui/route-progress-link\`) now starts the bar per-Link via
 * Next's \`onNavigate\`, which only fires for a real, uncancelled navigation.
 * This file keeps only the two signals a per-Link component cannot cover:
 * real browser back/forward (\`popstate\`) and the completion signal.
 */
export function RouteProgressBar({
  controller = routeProgressController,
}: RouteProgressBarProps = {}) {
  const phase = useSyncExternalStore(
    controller.subscribe,
    controller.getPhase,
    () => 'idle' as const
  )
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastKeyRef = useRef(toLocationKey(pathname, searchParams.toString()))
  // Separate from \`lastKeyRef\` for structural symmetry with the multi-locale
  // version of this file: there, the locale-aware \`usePathname()\` hook is
  // locale-*stripped* while \`handlePopState\` below only has the locale-
  // *prefixed* \`window.location.pathname\`, and comparing those two formats
  // directly caused a real regression (see \`route-progress-bar.test.tsx\`).
  // Single-locale mode has no \`[locale]\` segment, so \`usePathname()\` here
  // (\`next/navigation\`'s own) and \`window.location.pathname\` always agree
  // already -- this ref costs nothing to keep and avoids diverging the two
  // variants' logic over a distinction that no longer exists.
  const lastRawKeyRef = useRef<string | undefined>(undefined)

  // Start signal: real browser back/forward (popstate) -- listened for
  // once, for the component's whole lifetime. Link clicks start through
  // \`RouteProgressLink\`; programmatic push/replace/back/forward start
  // through \`useRouteProgressRouter()\`; neither goes through this effect.
  useEffect(() => {
    // Browser tests wait for this marker before exercising navigation. A
    // native control can be interactive before this Suspense island hydrates,
    // which otherwise tests a pre-hydration page rather than the progress bar.
    document.documentElement.dataset.routeProgressReady = ''
    function handlePopState() {
      const search = new URLSearchParams(window.location.search).toString()
      const key = toLocationKey(window.location.pathname, search)
      if (key !== lastRawKeyRef.current) controller.start()
    }
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pagehide', controller.dispose)
    return () => {
      delete document.documentElement.dataset.routeProgressReady
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pagehide', controller.dispose)
      controller.dispose()
    }
  }, [controller])

  // Completion signal: the officially-documented usePathname()/
  // useSearchParams() "router events" pattern -- fires once the
  // destination has actually committed. Also the single place that keeps
  // \`lastRawKeyRef\` current, since a commit is the only moment both the
  // semantic (\`pathname\`) and raw (\`window.location\`) URLs are guaranteed
  // to agree.
  useEffect(() => {
    lastRawKeyRef.current = toLocationKey(
      window.location.pathname,
      new URLSearchParams(window.location.search).toString()
    )
    const key = toLocationKey(pathname, searchParams.toString())
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key
      controller.finish()
    }
  }, [pathname, searchParams, controller])

  if (phase === 'idle' || phase === 'delaying') return null

  return (
    <div
      aria-hidden="true"
      data-phase={phase}
      data-testid="route-progress-bar"
      className={styles.bar}
    />
  )
}
`

export function buildWebNavRouteProgressBarSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/ui/route-progress-bar.tsx'),
      { expectedBefore: ROUTE_PROGRESS_BAR_BEFORE, after: AFTER },
      'route-progress-bar.tsx: drop locale-aware navigation'
    ),
  ]
}
