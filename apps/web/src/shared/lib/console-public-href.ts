import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'

/**
 * Returns the public overview address, never the internal proxy target.
 * Host mode serves the console at its own host root; path mode uses its slug.
 */
export function getConsoleOverviewHref(): string {
  if (ADMIN_CONSOLE_CONFIG.mode === 'host') return '/'
  if (ADMIN_CONSOLE_CONFIG.mode === 'path') return `/${ADMIN_CONSOLE_CONFIG.slug}`
  return '/'
}
