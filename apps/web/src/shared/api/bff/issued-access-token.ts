import 'server-only'

const REFRESH_SAFETY_MARGIN_MS = 30_000

/** Read metadata from an API-issued token. The API verifies the token on use. */
export function readIssuedAccessTokenClaims(accessToken: string): unknown {
  if (accessToken.length > 8192) return null
  const parts = accessToken.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function readAccessTokenExpiry(accessToken: string): number | null {
  const claims = readIssuedAccessTokenClaims(accessToken)
  if (!claims || typeof claims !== 'object' || !('exp' in claims) || typeof claims.exp !== 'number')
    return null
  const expiry = claims.exp * 1000
  return Number.isFinite(expiry) ? expiry : null
}

export function isAccessTokenFresh(accessToken: string, now: number): boolean {
  const expiry = readAccessTokenExpiry(accessToken)
  return expiry !== null && expiry > now + REFRESH_SAFETY_MARGIN_MS
}
