import { securityPath } from './organization-family'

import 'server-only'

// Classify the effective fetch pathname: URL construction has already resolved
// dot segments. Never decode it again or rewrite dynamic organization IDs.
const JWT_PATHS = [
  /^\/api\/v1\/auth\/(?:login|register|refresh|step-up)\/?$/i,
  /^\/api\/v1\/auth\/oauth\/exchange\/?$/i,
  /^\/api\/v1\/organizations\/[^/]+\/switch\/?$/i,
]

export function isCredentialRoute(upstream: URL): boolean {
  const path = securityPath(upstream.pathname)
  if (path === null) return true
  if (/^\/api\/v1\/(?:product-admin|console)(?:\/|$)/i.test(path)) return true
  if (
    /^\/api\/v1\/auth(?:\/|$)/i.test(path) &&
    !/^\/api\/v1\/auth\/(?:me(?:\/avatar)?|sessions(?:\/[^/]+)?)\/?$/i.test(path)
  )
    return true
  return (
    path === '/api/v1/auth/invites' ||
    path.startsWith('/api/v1/auth/invites/') ||
    JWT_PATHS.some((shape) => shape.test(path))
  )
}

export function isControlPlaneRoute(upstream: URL): boolean {
  const path = securityPath(upstream.pathname)
  return path === null || /^\/api\/v1\/(?:admin|console)(?:\/|$)/i.test(path)
}
