import { getConsoleHostname } from '@/shared/lib/admin-console-config'

import 'server-only'

function requestOrigin(request: Request): string | null {
  const value = request.headers.get('origin') ?? request.headers.get('referer')
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/** Console cookie mutations accept only the configured HTTPS console origin. */
export function isTrustedConsoleOrigin(request: Request): boolean {
  const hostname = getConsoleHostname()
  return requestOrigin(request) === `https://${hostname}`
}
