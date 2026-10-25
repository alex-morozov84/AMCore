import { parseConsoleExternalUrl } from './console-external-links'

export function parseConsoleMetricsDashboard(raw: string | undefined): string | null {
  const safe = parseConsoleExternalUrl(raw)
  if (!safe) return null
  const url = new URL(safe)
  return /(?:^|\/)d\/[A-Za-z0-9_-]+(?:\/[^/]+)?\/?$/.test(url.pathname) ? safe : null
}
/** The fixed interval is around the observation, never a claim about incident onset. */
export function consoleMetricsHref(
  dashboard: string | null,
  observedAt: string | null | undefined
): string | null {
  if (!dashboard || !observedAt || !parseConsoleMetricsDashboard(dashboard)) return null
  const time = Date.parse(observedAt)
  const from = time - 900_000
  const to = time + 900_000
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > 8_640_000_000_000_000
  )
    return null
  const url = new URL(dashboard)
  url.searchParams.set('from', String(from))
  url.searchParams.set('to', String(to))
  url.searchParams.delete('time')
  url.searchParams.delete('time.window')
  return url.href
}
