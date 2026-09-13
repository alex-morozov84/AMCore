import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'

/** Maps a physical console BFF suffix to its current public same-origin path. */
export function getConsolePublicApiPath(path: `/auth/${string}`): string {
  return ADMIN_CONSOLE_CONFIG.mode === 'host' ? path : `/console${path}`
}
