import { getConsoleOrigin, validateAdminConsoleStartup } from './admin-console-config'
import { assertConsoleExternalLinks } from './console-external-links'
import { assertConsoleLogSearchTarget } from './console-log-search-target'
import { productAdminOrigins } from './product-admin-config.server'

import 'server-only'

/** Terminates a Node server before it can accept traffic with invalid host or external-link config. */
export function validateAdminConsoleStartupOrExit(): void {
  try {
    validateAdminConsoleStartup()
    const consoleOrigin = getConsoleOrigin()
    if (consoleOrigin) {
      const { site, admin } = productAdminOrigins()
      const host = new URL(consoleOrigin).hostname
      if (host === new URL(site).hostname || host === new URL(admin).hostname)
        throw new Error('Separate Console requires a different hostname, regardless of port')
    }
    assertConsoleExternalLinks()
    assertConsoleLogSearchTarget()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid Operations Console configuration'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
