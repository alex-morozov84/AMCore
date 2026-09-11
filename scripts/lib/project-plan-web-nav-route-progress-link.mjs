// init:project --mode=single: route-progress-link.tsx (P1 item 8,
// reconverged FINAL PLAN item 5). Swaps `Link, usePathname` (from
// `@/i18n/navigation`) for `next/link`'s default export plus
// `usePathname`/`useSearchParams` merged into one `next/navigation` import
// -- single-locale mode has no [locale] segment, so neither needs locale
// awareness. Import order verified empirically (eslint --fix against a
// disposable copy), not guessed. Before text lives in
// project-plan-web-nav-route-progress-link-before.mjs (line-count guidance).
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'
import { ROUTE_PROGRESS_LINK_BEFORE } from './project-plan-web-nav-route-progress-link-before.mjs'

const AFTER = `'use client'

import type { ComponentProps } from 'react'
import { forwardRef } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

import {
  type RouteProgressController,
  routeProgressController,
} from '@/shared/lib/route-progress/route-progress-controller'
import { ROUTE_PROGRESS_ENABLED } from '@/shared/lib/route-progress/route-progress-flag'

type LinkProps = ComponentProps<typeof Link>
type OnNavigateEvent = Parameters<NonNullable<LinkProps['onNavigate']>>[0]

export interface RouteProgressLinkOwnProps {
  /** Escape hatch for isolated rendering (Storybook, tests) -- the real app
   *  never passes this, always the module singleton default. Mirrors
   *  \`RouteProgressBarProps.controller\` so a story/test can point a Link and
   *  a Bar at the same isolated instance. */
  controller?: RouteProgressController
}

/**
 * Resolves a \`Link\` \`href\` (string or \`UrlObject\`) to the same
 * \`pathname[?search]\` shape \`usePathname()\`/\`useSearchParams()\` produce, so
 * "is this link to the page we're already on" can be checked directly
 * against next-intl's locale-*stripped* values -- \`href\` here is already
 * unprefixed (next-intl's own convention), so this never touches
 * \`window.location\` or its locale-*prefixed* format at all.
 */
function hrefToKey(href: LinkProps['href'], currentKey: string): string {
  const currentUrl = new URL(currentKey, 'http://x')
  if (typeof href === 'string') {
    // Resolve against the current route, not the origin: \`#section\` and
    // \`?tab=details\` are relative references to the page already showing.
    const url = new URL(href, currentUrl)
    return url.search ? \`\${url.pathname}\${url.search}\` : url.pathname
  }
  const pathname = href.pathname ?? currentUrl.pathname
  const search =
    href.search != null
      ? href.search.replace(/^\\?/, '')
      : href.query
        ? new URLSearchParams(href.query as Record<string, string>).toString()
        : href.pathname == null
          ? currentUrl.searchParams.toString()
          : ''
  return search ? \`\${pathname}?\${search}\` : pathname
}

/**
 * The only sanctioned way to render a *navigating* \`<Link>\` once the route
 * progress bar is enabled — see \`useRouteProgressRouter\` for the
 * programmatic-navigation equivalent. Reconverged FINAL PLAN item 5
 * (2026-09-10, Agent 2 diff review): the original design used a bubbling
 * \`document\` click listener plus a manual \`isQualifyingLinkClick\` filter,
 * which could not tell an application's own cancelled navigation
 * (\`onNavigate\`'s \`event.preventDefault()\`) apart from Next's own
 * unconditional \`preventDefault()\` inside \`<Link>\`'s click handler — both
 * looked identical to a later \`document\`-level listener, so a genuinely
 * cancelled Link click still started the bar and then stranded it until
 * \`maxDurationMs\`'s safety net (found via Agent 2's real-browser repro).
 *
 * \`onNavigate\` (installed \`next/dist/docs/.../link.md\`, and confirmed
 * against \`next/dist/client/app-dir/link.js\`'s real \`linkClicked()\`) fires
 * *only* when Next has already decided this is a genuine same-origin,
 * client-side navigation -- modifier-key clicks, \`target\`, \`download\`, and
 * external URLs never reach it, so none of the old manual filters for those
 * are needed here anymore. The one thing \`onNavigate\` still doesn't filter
 * is a link to the page already showing (a pure hash link included) --
 * \`hrefToKey\` above handles exactly that, the same case the old
 * \`isQualifyingLinkClick\` covered with its same-URL check.
 */
export const RouteProgressLink = forwardRef<
  HTMLAnchorElement,
  LinkProps & RouteProgressLinkOwnProps
>(function RouteProgressLink(
  { onNavigate, href, controller = routeProgressController, ...rest },
  ref
) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleNavigate(event: OnNavigateEvent) {
    let cancelled = false
    onNavigate?.({
      ...event,
      preventDefault: () => {
        cancelled = true
        event.preventDefault()
      },
    })
    if (cancelled || !ROUTE_PROGRESS_ENABLED) return

    const currentSearch = searchParams.toString()
    const currentKey = currentSearch ? \`\${pathname}?\${currentSearch}\` : pathname
    if (hrefToKey(href, currentKey) === currentKey) return

    controller.start()
  }

  return <Link ref={ref} href={href} onNavigate={handleNavigate} {...rest} />
})
`

export function buildWebNavRouteProgressLinkSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/ui/route-progress-link.tsx'),
      { expectedBefore: ROUTE_PROGRESS_LINK_BEFORE, after: AFTER },
      'route-progress-link.tsx: drop locale-aware navigation'
    ),
  ]
}
