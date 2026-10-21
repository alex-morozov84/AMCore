import { parseConsoleExternalUrl } from './console-external-links'
import type { LogSearchTarget } from './log-search-link'

/** The web server setting: the address of the Grafana that has the log-search overlay's data source. */
export const CONSOLE_LOG_SEARCH_ENV = 'ADMIN_CONSOLE_LOGS_GRAFANA_URL'

type LogSearchEnvironment = Record<string, string | undefined>

/**
 * The configured log-search target, or `null` when the setting is empty or unusable (no links are
 * shown). Read at the moment of the call, while rendering a request, like the other external links.
 * Start-up (`assertConsoleLogSearchTarget`) is what reports an unusable value.
 */
export function getConsoleLogSearchTarget(
  env: LogSearchEnvironment = process.env
): LogSearchTarget | null {
  const baseUrl = parseConsoleExternalUrl(env[CONSOLE_LOG_SEARCH_ENV])
  return baseUrl ? { kind: 'grafana-loki', baseUrl } : null
}

/** Start-up check: a set but unusable value is a configuration error, not a quiet "not configured". */
export function assertConsoleLogSearchTarget(env: LogSearchEnvironment = process.env): void {
  const raw = env[CONSOLE_LOG_SEARCH_ENV]?.trim()
  if (raw && parseConsoleExternalUrl(raw) === null) {
    throw new Error(
      `${CONSOLE_LOG_SEARCH_ENV} must be an absolute https URL (or a loopback http URL) without credentials, spaces or wildcards`
    )
  }
}
