import { localizedFrontendUrl, type SupportedLocale } from '@amcore/shared'

/**
 * Query parameters that belong to a page's own identity, such as the page number of a listing
 * (`{ page: '2' }`). Every other parameter in a visitor's URL (filters, sort order, tracking) is
 * left out of canonical links, alternates, Open Graph URLs and the sitemap on purpose, so all of
 * those variants collapse into the one listed page.
 */
export type PageQuery = Readonly<Record<string, string>>

/**
 * The absolute URL of a page in one locale: `localizedFrontendUrl` plus the page's own query,
 * keys sorted so the same page always has the same canonical string.
 */
export function pageUrl(
  origin: string,
  locale: SupportedLocale,
  path: string,
  query?: PageQuery
): string {
  const entries = Object.entries(query ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return localizedFrontendUrl(
    origin,
    locale,
    path,
    entries.length > 0 ? Object.fromEntries(entries) : undefined
  )
}
