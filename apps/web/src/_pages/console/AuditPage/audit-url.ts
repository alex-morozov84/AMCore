import { type AdminAuditQuery, adminAuditQuerySchema } from '@amcore/shared'

export type RawAuditParams = Record<string, string | string[] | undefined>

/** Reject malformed/repeated keys visibly instead of silently dropping a filter. */
export function parseAuditParams(raw: RawAuditParams): AdminAuditQuery | null {
  const parsed = adminAuditQuerySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Audit-owned cursor/filter grammar; changing any filter starts at the newest row. */
export function auditHref(base: string, query: Partial<AdminAuditQuery>): string {
  const params = new URLSearchParams()
  for (const key of [
    'actorId',
    'actorType',
    'action',
    'actions',
    'targetId',
    'targetType',
    'organizationId',
    'includeReadEvents',
    'from',
    'to',
    'limit',
    'cursor',
  ] as const) {
    const value = query[key]
    if (value !== undefined) params.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const encoded = params.toString()
  return encoded ? `${base}?${encoded}` : base
}

export function auditRowFilter(
  base: string,
  query: AdminAuditQuery,
  key: 'actorId' | 'targetId' | 'organizationId' | 'action',
  value: string
): string {
  const rest = { ...query }
  delete rest.cursor
  if (key === 'action') delete rest.actions
  return auditHref(base, { ...rest, [key]: value })
}

export function auditCursorReset(base: string, query: AdminAuditQuery): string {
  const rest = { ...query }
  delete rest.cursor
  return auditHref(base, rest)
}
