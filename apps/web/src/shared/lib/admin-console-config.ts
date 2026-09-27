import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'

const FQDN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
type ConsoleEnvironment = {
  ADMIN_CONSOLE_HOSTNAME?: string | undefined
  ADMIN_CONSOLE_ORIGIN?: string | undefined
}

export function getConsoleHostname(env?: ConsoleEnvironment): string | undefined {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return undefined

  const hostname = env?.ADMIN_CONSOLE_HOSTNAME ?? process.env.ADMIN_CONSOLE_HOSTNAME
  if (!hostname || !FQDN.test(hostname)) {
    throw new Error('ADMIN_CONSOLE_HOSTNAME must be a lowercase FQDN when host mode is enabled')
  }

  return hostname
}

export function validateAdminConsoleStartup(env?: ConsoleEnvironment): void {
  getConsoleOrigin(env)
}

/** Explicit public HTTPS origin; hostname routing remains a separate guard. */
export function getConsoleOrigin(env?: ConsoleEnvironment): string | undefined {
  const hostname = getConsoleHostname(env)
  if (!hostname) return undefined
  const value = env?.ADMIN_CONSOLE_ORIGIN ?? process.env.ADMIN_CONSOLE_ORIGIN
  if (!value) return `https://${hostname}`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid ADMIN_CONSOLE_ORIGIN')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== hostname ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'ADMIN_CONSOLE_ORIGIN must be a canonical HTTPS origin matching ADMIN_CONSOLE_HOSTNAME'
    )
  }
  return url.origin
}
