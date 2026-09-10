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
 * Bubbling, never capture. Deliberately does **not** check
 * \`event.defaultPrevented\`, despite that being FINAL PLAN item 5's original
 * wording: verified against Next's real \`next/dist/client/link.js\` that
 * \`<Link>\`'s own \`onClick\` (\`linkClicked()\`) unconditionally calls
 * \`preventDefault()\` as a normal part of doing client-side navigation --
 * and because React registers its root-level synthetic-event listener at
 * (near-)\`document\` during the initial render, well before this
 * component's own \`useEffect\` can add its listener, React's handler (and
 * so Next's \`preventDefault()\`) always runs first. Checking
 * \`defaultPrevented\` here would therefore reject every real \`<Link>\` click,
 * not just ones an app cancelled. Confirmed empirically (\`nextjs-toploader\`,
 * the FINAL PLAN's own cited reference implementation, does not check it
 * either -- read its real source, not assumed). Filters: not the
 * primary/unmodified click, not a same-origin \`<a>\`, opens elsewhere
 * (\`target\`/\`download\`), or the destination path+query is identical to the
 * current one (a pure hash link or a link to the current page).
 */
function isQualifyingLinkClick(event: MouseEvent): boolean {
  if (event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
  if (!anchor) return false
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false

  const url = new URL(anchor.getAttribute('href')!, window.location.href)
  if (!/^https?:$/.test(url.protocol)) return false
  if (url.origin !== window.location.origin) return false

  return url.pathname + url.search !== window.location.pathname + window.location.search
}

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

  // Start signals: a qualifying Link click, and real browser back/forward
  // (popstate) -- both listened for once, for the component's whole
  // lifetime. Programmatic push/replace/back/forward instead start through
  // \`useRouteProgressRouter()\`, not this effect.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (isQualifyingLinkClick(event)) controller.start()
    }
    function handlePopState() {
      const search = new URLSearchParams(window.location.search).toString()
      const key = toLocationKey(window.location.pathname, search)
      if (key !== lastKeyRef.current) controller.start()
    }
    document.addEventListener('click', handleClick)
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pagehide', controller.dispose)
    return () => {
      document.removeEventListener('click', handleClick)
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pagehide', controller.dispose)
      controller.dispose()
    }
  }, [controller])

  // Completion signal: the officially-documented usePathname()/
  // useSearchParams() "router events" pattern -- fires once the
  // destination has actually committed.
  useEffect(() => {
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
