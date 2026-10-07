import type { OrganizationContextFamily } from '@amcore/shared'

const UNRESERVED = /^[A-Za-z0-9._~-]$/

export function securityPath(path: string): string | null {
  if (/%(?![0-9a-f]{2})/i.test(path) || /%(?:2f|5c|25)/i.test(path) || path.includes('\\'))
    return null
  const normalized = path.replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
    const decoded = String.fromCharCode(Number.parseInt(hex, 16))
    return UNRESERVED.test(decoded) ? decoded : encoded
  })
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return null
  return normalized.replace(/\/+/g, '/').toLowerCase().replace(/\/$/, '')
}

/** Classify the final fetch URL without rewriting its outbound path or dynamic IDs. */
export function isClosedOrganizationFamily(
  upstream: URL,
  families: readonly OrganizationContextFamily[],
  apiBase: string
): boolean {
  if (families.length === 0) return false
  const path = securityPath(upstream.pathname)
  if (path === null) return true
  return families.some(({ apiRoots }) =>
    apiRoots.some((root) => {
      const boundary = securityPath(new URL(`${apiBase.replace(/\/$/, '')}${root}`).pathname)
      if (!boundary) throw new Error('Invalid organization family boundary')
      return path === boundary || path.startsWith(`${boundary}/`)
    })
  )
}
