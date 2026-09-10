// init:project --mode=single: use-route-progress-router.ts (P1 item 8).
// This is the ONE file that swaps navigation source for single-locale mode --
// use-login.ts/use-register.ts still get their own transform (dropping the
// `{ locale }` push option, unrelated to which router implementation backs
// it), but use-logout.ts and primary-unavailable-fallback.tsx need no edit
// at all: both call only option-less/locale-less router methods
// (`push('/login')`, `refresh()`), so once this one file no longer imports
// from `@/i18n/navigation`, they are already correct as committed. Import
// order verified empirically (real eslint --fix against a disposable copy
// at the real path) rather than guessed -- 'react' and 'next/navigation'
// merge into one group with no blank line, unlike the multi-locale
// original's 'react' / blank / '@/i18n/navigation' split.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `'use client'

import { useMemo } from 'react'

import { useRouter } from '@/i18n/navigation'

import { routeProgressController } from './route-progress-controller'

/**
 * The only sanctioned way to fire a *programmatic* navigation once the route
 * progress bar is enabled — a Link click is already covered by the bar's own
 * document-level listener, but \`router.push()\`/\`replace()\`/\`back()\`/
 * \`forward()\` calls (form submits, redirects after a mutation, etc.) have no
 * other start signal. Wraps \`@/i18n/navigation\`'s \`useRouter()\` one-for-one:
 * every option/type is preserved, only push/replace/back/forward gain a
 * \`routeProgressController.start()\` call before delegating. \`refresh()\` and
 * \`prefetch()\` pass through untouched — neither is a "navigation" the bar
 * should represent (FINAL PLAN item 6).
 *
 * A lint guard (\`route-progress-router-adapter\` rule) flags a raw
 * \`@/i18n/navigation\` \`useRouter()\` call outside this file's own use of it,
 * so a later call site cannot silently bypass the bar.
 */
export function useRouteProgressRouter() {
  const router = useRouter()

  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        routeProgressController.start()
        router.push(...args)
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        routeProgressController.start()
        router.replace(...args)
      },
      back: () => {
        routeProgressController.start()
        router.back()
      },
      forward: () => {
        routeProgressController.start()
        router.forward()
      },
    }),
    [router]
  )
}
`

const AFTER = `'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { routeProgressController } from './route-progress-controller'

/**
 * The only sanctioned way to fire a *programmatic* navigation once the route
 * progress bar is enabled — a Link click is already covered by the bar's own
 * document-level listener, but \`router.push()\`/\`replace()\`/\`back()\`/
 * \`forward()\` calls (form submits, redirects after a mutation, etc.) have no
 * other start signal. Wraps \`next/navigation\`'s \`useRouter()\` one-for-one:
 * every option/type is preserved, only push/replace/back/forward gain a
 * \`routeProgressController.start()\` call before delegating. \`refresh()\` and
 * \`prefetch()\` pass through untouched — neither is a "navigation" the bar
 * should represent (FINAL PLAN item 6).
 *
 * A lint guard (\`route-progress-router-adapter\` rule) flags a raw
 * \`next/navigation\` \`useRouter()\` call outside this file's own use of it,
 * so a later call site cannot silently bypass the bar.
 */
export function useRouteProgressRouter() {
  const router = useRouter()

  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        routeProgressController.start()
        router.push(...args)
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        routeProgressController.start()
        router.replace(...args)
      },
      back: () => {
        routeProgressController.start()
        router.back()
      },
      forward: () => {
        routeProgressController.start()
        router.forward()
      },
    }),
    [router]
  )
}
`

export function buildWebNavRouteProgressRouterSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/lib/route-progress/use-route-progress-router.ts'),
      { expectedBefore: BEFORE, after: AFTER },
      'use-route-progress-router.ts: drop locale-aware navigation'
    ),
  ]
}
