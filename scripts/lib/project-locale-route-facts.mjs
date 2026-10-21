import { localeContent, localeDelete, localeMove } from './project-locale-fact-helpers.mjs'
import {
  LOCALE_DELETES,
  LOCALE_PURE_MOVES,
  LOCALE_REWRITTEN_MOVES,
  localeRouteMove,
} from './project-locale-route-paths.mjs'

const operationFor = (relative) => {
  if (relative === 'layout.tsx') return 'locale.root-layout'
  if (relative.endsWith('auth/callback/page.tsx')) return 'locale.completion-page'
  if (relative.endsWith('/route.ts') && !relative.includes('/invite/'))
    return 'locale.legacy-admin-route'
  if (relative.includes('/invite/')) return 'locale.invitation-route'
  return 'locale.auth-page'
}

export function buildLocaleRouteFacts(locale) {
  const pureMoves = LOCALE_PURE_MOVES.map(localeRouteMove).map(localeMove)
  const rewrittenMoves = LOCALE_REWRITTEN_MOVES.flatMap((relative) => {
    const move = localeRouteMove(relative)
    return [localeMove(move), localeContent(move.from, operationFor(relative), locale)]
  })
  return [...pureMoves, ...rewrittenMoves, ...LOCALE_DELETES.map(localeDelete)]
}
