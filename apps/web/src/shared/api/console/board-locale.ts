import { DEFAULT_LOCALE, localePathPrefix, SUPPORTED_LOCALES } from '@amcore/shared'

import { getConsoleBackgroundWorkHref } from '@/shared/lib/console-public-href'

import 'server-only'

export type BoardLocale = (typeof SUPPORTED_LOCALES)[number]

/** The visitor's language from the `NEXT_LOCALE` cookie, or the default when it is absent or unknown. */
export function readBoardLocale(request: Request): BoardLocale {
  const cookie = request.headers.get('cookie') ?? ''
  const value = /(?:^|;\s*)NEXT_LOCALE=([^;]*)/.exec(cookie)?.[1]
  return SUPPORTED_LOCALES.find((locale) => locale === value) ?? DEFAULT_LOCALE
}

/**
 * Where a failed or hidden open sends a document navigation back to: the Background work page, under
 * the visitor's locale prefix. `localePathPrefix` is the shared contract for that prefix (every locale
 * is explicit, and none once a fork keeps a single locale), so this works unchanged in both modes.
 */
export function consoleBackgroundWorkPath(request: Request): string {
  return `${localePathPrefix(readBoardLocale(request))}${getConsoleBackgroundWorkHref()}`
}
