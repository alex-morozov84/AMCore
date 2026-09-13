import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'

const FQDN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
type ConsoleEnvironment = { ADMIN_CONSOLE_HOSTNAME?: string | undefined }

export function getConsoleHostname(env?: ConsoleEnvironment): string | undefined {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return undefined

  const hostname = env?.ADMIN_CONSOLE_HOSTNAME ?? process.env.ADMIN_CONSOLE_HOSTNAME
  if (!hostname || !FQDN.test(hostname)) {
    throw new Error('ADMIN_CONSOLE_HOSTNAME must be a lowercase FQDN when host mode is enabled')
  }

  return hostname
}

export function validateAdminConsoleStartup(env?: ConsoleEnvironment): void {
  getConsoleHostname(env)
}
