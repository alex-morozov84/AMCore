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

/** Same topology rule as {@link getConsoleOverviewHref}, for the Organizations panel. */
export function getConsoleOrganizationsHref(): string {
  return `${getConsoleOverviewHref().replace(/\/$/, '')}/organizations`
}

/** Same topology rule as {@link getConsoleOverviewHref}, for the Users panel. */
export function getConsoleUsersHref(): string {
  return `${getConsoleOverviewHref().replace(/\/$/, '')}/users`
}

/** Audit is a separate bounded cursor/filter route in both Console topologies. */
export function getConsoleAuditHref(): string {
  return `${getConsoleOverviewHref().replace(/\/$/, '')}/audit`
}

/** Open identity activity in the widest single interval accepted by Audit. */
export function getConsoleDetailAuditHref(
  filters: { actorId?: string; targetId?: string; targetType?: 'USER'; organizationId?: string },
  now = Date.now()
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value)
  }
  query.set('from', new Date(now - 31 * 24 * 60 * 60_000).toISOString())
  query.set('to', new Date(now).toISOString())
  return `${getConsoleAuditHref()}?${query}`
}

function detailHref(base: string, id: string, returnTo?: string): string {
  const path = `${base}/${encodeURIComponent(id)}`
  return returnTo ? `${path}?${new URLSearchParams({ returnTo })}` : path
}

export function getConsoleUserDetailHref(id: string, returnTo?: string): string {
  return detailHref(getConsoleUsersHref(), id, returnTo)
}

export function getConsoleOrganizationDetailHref(id: string, returnTo?: string): string {
  return detailHref(getConsoleOrganizationsHref(), id, returnTo)
}

const DISCOVERY_KEYS = new Set(['page', 'search', 'sortBy', 'sortOrder'])
const AUDIT_KEYS = new Set([
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
])

/** Only an exact, bounded Console inventory/Audit URL may become a return target. */
export function parseConsoleReturnHref(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    return null
  let url: URL
  try {
    url = new URL(value, 'http://console.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'http://console.invalid') return null
  if (value.split('?')[0] !== url.pathname) return null
  const keys =
    url.pathname === getConsoleAuditHref()
      ? AUDIT_KEYS
      : url.pathname === getConsoleUsersHref() || url.pathname === getConsoleOrganizationsHref()
        ? DISCOVERY_KEYS
        : null
  if (!keys) return null
  const seen = new Set<string>()
  for (const key of url.searchParams.keys()) {
    if (!keys.has(key) || seen.has(key)) return null
    seen.add(key)
  }
  return `${url.pathname}${url.search}`
}
