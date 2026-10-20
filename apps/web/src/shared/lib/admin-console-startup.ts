import { validateAdminConsoleStartup } from './admin-console-config'
import { assertConsoleExternalLinks } from './console-external-links'
import { assertConsoleLogSearchTarget } from './console-log-search-target'

import 'server-only'

/** Terminates a Node server before it can accept traffic with invalid host or external-link config. */
export function validateAdminConsoleStartupOrExit(): void {
  try {
    validateAdminConsoleStartup()
    assertConsoleExternalLinks()
    assertConsoleLogSearchTarget()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid Operations Console configuration'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
