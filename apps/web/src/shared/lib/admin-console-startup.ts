import { validateAdminConsoleStartup } from './admin-console-config'

import 'server-only'

/** Terminates a Node server before it can accept traffic with invalid host config. */
export function validateAdminConsoleStartupOrExit(): void {
  try {
    validateAdminConsoleStartup()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid Operations Console configuration'
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
