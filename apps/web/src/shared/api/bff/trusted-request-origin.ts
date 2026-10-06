import { ContextRequestError } from './context-errors'

import 'server-only'

/** Resolve a render's canonical origin from configured trust and actual Host, never forwarded protocol. */
export function trustedRequestOrigin(headers: Headers, fallbackUrl?: string): string {
  const origins = (process.env.WEB_TRUSTED_ORIGINS ?? 'http://localhost:3002').split(',').map(value => value.trim())
  const matching = origins.filter(origin => {
    const parsed = new URL(origin)
    return parsed.origin === origin && (headers.has('host') ? parsed.host === headers.get('host') : fallbackUrl !== undefined && parsed.origin === new URL(fallbackUrl).origin)
  })
  if (matching.length !== 1) throw new ContextRequestError(403, 'FORBIDDEN')
  return matching[0]!
}
