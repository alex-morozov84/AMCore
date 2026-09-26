import 'server-only'

// Classify the effective fetch pathname: URL construction has already resolved
// dot segments. Never decode it again or rewrite dynamic organization IDs.
const JWT_PATHS = [
  /^\/api\/v1\/auth\/(?:login|register|refresh|step-up)\/?$/i,
  /^\/api\/v1\/auth\/oauth\/exchange\/?$/i,
  /^\/api\/v1\/organizations\/[^/]+\/switch\/?$/i,
]

export function isCredentialRoute(upstream: URL): boolean {
  return JWT_PATHS.some((shape) => shape.test(upstream.pathname))
}
