import type { Request } from 'express'

const GLOBAL_PREFIX = '/api/v1'
const UNKNOWN_ROUTE = 'unknown'
const UNMATCHED_ROUTE = 'unmatched'

type RequestWithRoute = Request & {
  route?: {
    path?: unknown
  }
}

export function normalizeRouteTemplate(req: Request): string {
  const routePath = (req as RequestWithRoute).route?.path
  if (routePath === undefined) {
    return UNMATCHED_ROUTE
  }

  if (typeof routePath !== 'string') {
    return UNKNOWN_ROUTE
  }

  if (!isSafeRouteTemplate(routePath)) {
    return UNKNOWN_ROUTE
  }

  const joined = routePath.startsWith('/') ? routePath : joinPaths(GLOBAL_PREFIX, routePath)

  if (joined === '/' || joined === '') {
    return GLOBAL_PREFIX
  }

  if (joined.startsWith(GLOBAL_PREFIX)) {
    return joined
  }

  if (req.originalUrl.startsWith(GLOBAL_PREFIX)) {
    return joinPaths(GLOBAL_PREFIX, joined)
  }

  return joined
}

function isSafeRouteTemplate(path: string): boolean {
  if (path.includes('?')) return false
  if (path.includes('*')) return false
  if (path.includes('(') || path.includes(')')) return false
  if (path.includes('[') || path.includes(']')) return false
  return true
}

function joinPaths(...parts: string[]): string {
  const filtered = parts
    .filter((part) => part !== '')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')

  return `/${filtered.join('/')}`.replace(/\/{2,}/g, '/')
}
