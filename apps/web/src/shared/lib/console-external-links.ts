/**
 * The addresses of the external tools the Console links to (metrics, logs, alerts). An operator sets
 * them in the web server environment; the Console never fetches them, probes them or redirects
 * through them, it only renders the normalized address as a plain link.
 */
export const CONSOLE_EXTERNAL_TOOLS = ['metrics', 'logs', 'alerts'] as const

export type ConsoleExternalTool = (typeof CONSOLE_EXTERNAL_TOOLS)[number]

export const CONSOLE_EXTERNAL_LINK_ENV = {
  metrics: 'ADMIN_CONSOLE_METRICS_URL',
  logs: 'ADMIN_CONSOLE_LOGS_URL',
  alerts: 'ADMIN_CONSOLE_ALERTS_URL',
} as const satisfies Record<ConsoleExternalTool, string>

export type ConsoleExternalLinks = Record<ConsoleExternalTool, string | null>

type ExternalLinkEnvironment = Record<string, string | undefined>

const MAX_URL_LENGTH = 2048

/**
 * Returns the normalized address of a usable link, or `null` when the value is empty or unsafe.
 * Only `https` is accepted (`http` for a loopback host, for local stands). Credentials, wildcard hosts,
 * whitespace, control characters and relative or scheme-less values are refused, so what the Console
 * renders is always an absolute address that names one host. Path, query and fragment are kept: a
 * dashboard link needs them. A secret placed in the query cannot be detected here; the operator guide
 * says not to do that.
 */
export function parseConsoleExternalUrl(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value || value.length > MAX_URL_LENGTH) return null
  if (/[\s\p{Cc}]/u.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  // `new URL` accepts a wildcard host such as `*.example.com`; a link must name one host.
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) return null
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.href
  return null
}

/**
 * The configured links, read from the environment at the moment of the call. Call it while rendering
 * a request, never at module load: a module-level read could be evaluated during a build. An unusable
 * value gives `null` here; start-up (`assertConsoleExternalLinks`) is what reports it.
 */
export function getConsoleExternalLinks(
  env: ExternalLinkEnvironment = process.env
): ConsoleExternalLinks {
  return {
    metrics: parseConsoleExternalUrl(env[CONSOLE_EXTERNAL_LINK_ENV.metrics]),
    logs: parseConsoleExternalUrl(env[CONSOLE_EXTERNAL_LINK_ENV.logs]),
    alerts: parseConsoleExternalUrl(env[CONSOLE_EXTERNAL_LINK_ENV.alerts]),
  }
}

/**
 * Start-up check: a set but unusable value is a configuration error, not a quiet "not configured",
 * so a typo such as `http://grafana.example.com` is found at boot. An unset or blank value is allowed.
 */
export function assertConsoleExternalLinks(env: ExternalLinkEnvironment = process.env): void {
  for (const tool of CONSOLE_EXTERNAL_TOOLS) {
    const name = CONSOLE_EXTERNAL_LINK_ENV[tool]
    const raw = env[name]?.trim()
    if (raw && parseConsoleExternalUrl(raw) === null) {
      throw new Error(
        `${name} must be an absolute https URL (or a loopback http URL) without credentials, spaces or wildcards`
      )
    }
  }
}
