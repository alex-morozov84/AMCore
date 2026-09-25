import type { AdminAuditQuery } from '@amcore/shared'

const DAY_MS = 24 * 60 * 60_000
const DEFAULT_WINDOW_MS = 7 * DAY_MS
const MAX_WINDOW_MS = 31 * DAY_MS

export type AuditRangeError = 'invalid' | 'future' | 'tooLong'

export function auditRangeError(
  from: string | null,
  to: string | null,
  now = Date.now()
): AuditRangeError | null {
  if (!from || !to || Date.parse(from) >= Date.parse(to)) return 'invalid'
  if (Date.parse(to) > now) return 'future'
  if (Date.parse(to) - Date.parse(from) > MAX_WINDOW_MS) return 'tooLong'
  return null
}

/** Match the API's effective-window rule before the first read. */
export function resolveAuditWindow(
  query: AdminAuditQuery,
  now = Date.now()
): AdminAuditQuery | null {
  if (query.cursor && (!query.from || !query.to)) return null
  const to = query.to ?? new Date(now).toISOString()
  const from = query.from ?? new Date(Date.parse(to) - DEFAULT_WINDOW_MS).toISOString()
  if (auditRangeError(from, to, now)) return null
  return { ...query, from, to }
}
