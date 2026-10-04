import { type BoardRenderContext, parseBoardRenderContext } from '@amcore/shared'

import { getPathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import {
  getConsoleBackgroundWorkHref,
  getConsoleQueueBoardBasePath,
} from '@/shared/lib/console-public-href'

import 'server-only'

/** The one API mount the board bridge may reach. Never built from anything the client chooses. */
export const BOARD_UPSTREAM_PATH = '/api/v1/admin/queues'

const SEGMENT = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_SEGMENTS = 6
const MAX_PATH_LENGTH = 400
const QUERY_KEYS = new Set(['activeQueue', 'status', 'page', 'jobsPerPage'])
const QUERY_VALUE = /^[A-Za-z0-9:_-]{1,64}$/

/**
 * The upstream URL of a board request, or `null` when the path or query is not one the board uses.
 * The browser's path becomes plain segments under the fixed mount: no encoded characters, no dot
 * segments, no empty segments, bounded length and count, and only the four query keys the board UI
 * sends. The API repeats these checks; this is the first of two.
 */
export function buildBoardUpstreamUrl(
  apiUrl: string,
  segments: readonly string[],
  search: string
): URL | null {
  if (segments.length > MAX_SEGMENTS) return null
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') return null
  }
  const tail = segments.length > 0 ? `/${segments.join('/')}` : ''
  if (tail.length > MAX_PATH_LENGTH) return null

  const query = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const [key, value] of query) {
    if (!QUERY_KEYS.has(key) || !QUERY_VALUE.test(value) || kept.has(key)) return null
    kept.set(key, value)
  }

  const url = new URL(`${apiUrl.replace(/\/$/, '')}${BOARD_UPSTREAM_PATH}${tail}`)
  if (url.pathname !== `${BOARD_UPSTREAM_PATH}${tail}`) return null
  url.search = kept.toString()
  return url
}

function readLocale(request: Request): (typeof routing.locales)[number] {
  const cookie = request.headers.get('cookie') ?? ''
  const value = /(?:^|;\s*)NEXT_LOCALE=([^;]*)/.exec(cookie)?.[1]
  return routing.locales.find((locale) => locale === value) ?? routing.defaultLocale
}

/** Where a failed or hidden open sends a document navigation back to: the Background work page. */
export function consoleBackgroundWorkPath(request: Request): string {
  return getPathname({ href: getConsoleBackgroundWorkHref(), locale: readLocale(request) })
}

/** The render context the API needs: public base path, language and the way back to the Console. */
export function buildBoardRenderContext(request: Request): BoardRenderContext | null {
  return parseBoardRenderContext({
    basePath: getConsoleQueueBoardBasePath(),
    locale: readLocale(request),
    returnHref: consoleBackgroundWorkPath(request),
  })
}

export function encodeBoardRenderContext(context: BoardRenderContext): string {
  return Buffer.from(JSON.stringify(context)).toString('base64url')
}
