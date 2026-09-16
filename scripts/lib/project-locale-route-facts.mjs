import { localeContent, localeDelete, localeMove } from './project-locale-fact-helpers.mjs'
import {
  LOCALE_DELETES,
  LOCALE_PURE_MOVES,
  LOCALE_REWRITTEN_MOVES,
  localeRouteMove,
} from './project-locale-route-paths.mjs'

const operationFor = (relative) => {
  if (relative === 'layout.tsx') return 'locale.root-layout'
  if (relative === '(auth)/layout.tsx') return 'locale.auth-layout'
  if (relative === 'auth/callback/route.ts') return 'locale.oauth-callback-route'
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
