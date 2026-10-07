import { isOrganizationContextId } from '@amcore/shared'

/**
 * Exact raw path match for the role-definition JSON commands (create, save, delete); encoded
 * separators or foreign ids never widen the scoped parser. The body-parser limit counts decoded
 * (post-inflation) bytes, so a small gzip body inflating past the limit is still rejected.
 */
export function isRoleDefinitionJsonRequest(
  request: { method?: string; url?: string; headers: Record<string, unknown> },
  prefix: string
): boolean {
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType))
    return false
  const path = (request.url ?? '').split('?')[0] ?? ''
  if (!path.startsWith(prefix + '/')) return false
  const parts = path.slice(prefix.length).split('/')
  if (parts[1] !== 'organizations' || !isOrganizationContextId(parts[2])) return false
  if (parts[3] !== 'role-definitions') return false
  if (parts.length === 4) return request.method === 'POST'
  if (!isOrganizationContextId(parts[4])) return false
  if (parts.length === 5) return request.method === 'PATCH'
  return parts.length === 6 && parts[5] === 'deletion' && request.method === 'POST'
}
