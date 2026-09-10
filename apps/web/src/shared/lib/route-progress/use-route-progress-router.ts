'use client'

import { useMemo } from 'react'

import { useRouter } from '@/i18n/navigation'

import { routeProgressController } from './route-progress-controller'
import { ROUTE_PROGRESS_ENABLED } from './route-progress-flag'

function startProgress() {
  if (ROUTE_PROGRESS_ENABLED) routeProgressController.start()
}

/**
 * The only sanctioned way to fire a *programmatic* navigation once the route
 * progress bar is enabled — a Link click is already covered by the bar's own
 * document-level listener, but `router.push()`/`replace()`/`back()`/
 * `forward()` calls (form submits, redirects after a mutation, etc.) have no
 * other start signal. Wraps `@/i18n/navigation`'s `useRouter()` one-for-one:
 * every option/type is preserved, only push/replace/back/forward gain a
 * `routeProgressController.start()` call before delegating. `refresh()` and
 * `prefetch()` pass through untouched — neither is a "navigation" the bar
 * should represent (FINAL PLAN item 6).
 *
 * A lint guard (`route-progress-router-adapter` rule) flags a raw
 * `@/i18n/navigation` `useRouter()` call outside this file's own use of it,
 * so a later call site cannot silently bypass the bar.
 */
export function useRouteProgressRouter() {
  const router = useRouter()

  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        startProgress()
        router.push(...args)
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        startProgress()
        router.replace(...args)
      },
      back: () => {
        startProgress()
        router.back()
      },
      forward: () => {
        startProgress()
        router.forward()
      },
    }),
    [router]
  )
}
