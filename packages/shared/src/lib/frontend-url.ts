import type { SupportedLocale } from '../constants'

const SLASH = '/'.charCodeAt(0)

/**
 * Build a link into the web app for a specific locale.
 *
 * `apps/web` routes every locale under an explicit prefix (`/en/...`,
 * `/ru/...`) — see `docs/frontend/architecture-and-conventions.md` →
 * "Locale routing". A server-generated link that omits the prefix lands on the
 * unprefixed path and is resolved by cookie or `Accept-Language`, which is
 * exactly what a link *from an email* cannot rely on: the recipient may open it
 * in a browser that has never visited the app. A Russian email would then open
 * an English page.
 *
 * So any URL the backend puts in front of a user must carry the locale the
 * backend already knows — the recipient's stored `User.locale`.
 *
 * Lives in `packages/shared` deliberately: the prefix strategy is a contract
 * both apps must agree on, like `SUPPORTED_LOCALES` itself. If the frontend
 * ever changes it, this is the one place the backend follows.
 */
export function localizedFrontendUrl(
  baseUrl: string,
  locale: SupportedLocale,
  path = '',
  query?: Record<string, string>
): string {
  const base = trimTrailingSlashes(baseUrl)
  const trimmedPath = trimLeadingSlashes(path)
  const suffix = trimmedPath ? `/${trimmedPath}` : ''

  // Built by hand rather than via `URL`: this package is consumed by both the
  // browser and the API, and its build target does not expose the global.
  const search = Object.entries(query ?? {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

  return `${base}/${locale}${suffix}${search ? `?${search}` : ''}`
}

/**
 * Slash trimming is done with index arithmetic rather than `/\/+$/` on purpose.
 * An anchored one-or-more quantifier over a repeated character backtracks
 * quadratically on a long run of slashes (CodeQL `js/polynomial-redos`). The
 * inputs here are a configured base URL and a caller-supplied path, so it is
 * not reachable by an attacker today — but this is a shared library helper, and
 * the linear version costs nothing.
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) end--
  return value.slice(0, end)
}

function trimLeadingSlashes(value: string): string {
  let start = 0
  while (start < value.length && value.charCodeAt(start) === SLASH) start++
  return value.slice(start)
}
