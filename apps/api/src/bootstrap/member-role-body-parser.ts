import { isOrganizationContextId } from '@amcore/shared'

/** Exact raw path match: encoded separators/IDs never widen the parser exception. */
export function isMemberRoleJsonRequest(
  request: { method?: string; url?: string; headers: Record<string, unknown> },
  prefix: string
): boolean {
  if (request.method !== 'PATCH') return false
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType))
    return false
  const path = (request.url ?? '').split('?')[0] ?? ''
  const parts = path.slice(prefix.length).split('/')
  return (
    path.startsWith(prefix + '/') &&
    parts.length === 6 &&
    parts[1] === 'organizations' &&
    isOrganizationContextId(parts[2]) &&
    parts[3] === 'members' &&
    isOrganizationContextId(parts[4]) &&
    parts[5] === 'roles'
  )
}
