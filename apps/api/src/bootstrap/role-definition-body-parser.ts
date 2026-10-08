/**
 * Budget classification for the role-definition commands. It decides only which body-size cap
 * applies and never rewrites routing or identifiers. The application's router accepts equivalent
 * spellings of these paths (trailing slash, any letter case, percent-encoded unreserved characters
 * in dynamic ids), so the shape is matched on a normalized copy: any request that could reach a
 * role-definition command gets the 16 KiB decoded cap, whatever its method or id spelling.
 */
function budgetPath(url: string): string {
  const raw = url.split('?')[0] ?? ''
  return raw
    .replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
      const char = String.fromCharCode(Number.parseInt(hex, 16))
      return /^[A-Za-z0-9._~-]$/.test(char) ? char : encoded
    })
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

/** `/organizations/:id/role-definitions`, `…/:roleId` and `…/:roleId/deletion` under the prefix. */
export function isRoleDefinitionRequest(request: { url?: string }, prefix: string): boolean {
  const path = budgetPath(request.url ?? '')
  const base = budgetPath(prefix)
  if (!path.toLowerCase().startsWith(base.toLowerCase() + '/')) return false
  const parts = path.slice(base.length).split('/')
  // ['', 'organizations', id, 'role-definitions', roleId?, 'deletion'?]
  if (parts[1]?.toLowerCase() !== 'organizations' || !parts[2]) return false
  if (parts[3]?.toLowerCase() !== 'role-definitions') return false
  if (parts.length === 4) return true
  if (!parts[4]) return false
  if (parts.length === 5) return true
  return parts.length === 6 && parts[5]?.toLowerCase() === 'deletion'
}

const media = (request: { headers: Record<string, unknown> }): string => {
  const type = request.headers['content-type']
  return typeof type === 'string' ? type.toLowerCase() : ''
}

/** JSON commands: same cap for every spelling of the path. */
export function isRoleDefinitionJsonRequest(
  request: { url?: string; headers: Record<string, unknown> },
  prefix: string
): boolean {
  return (
    /^application\/json(?:\s*;|$)/.test(media(request)) && isRoleDefinitionRequest(request, prefix)
  )
}

/** Form bodies are admitted by the global parser, so they get the same decoded cap here. */
export function isRoleDefinitionFormRequest(
  request: { url?: string; headers: Record<string, unknown> },
  prefix: string
): boolean {
  return (
    /^application\/x-www-form-urlencoded(?:\s*;|$)/.test(media(request)) &&
    isRoleDefinitionRequest(request, prefix)
  )
}
