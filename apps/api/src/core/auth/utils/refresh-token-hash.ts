import { createHash } from 'crypto'

/**
 * Hash a raw refresh token into its stored lookup key.
 *
 * Shared pure helper so the auth token path (`TokenService.hashRefreshToken`)
 * and the read-only Bull Board verifier (`BullBoardAuthService`) compute the
 * identical `Session.refreshToken` key without duplicating the
 * security-relevant transform. Keep it a plain SHA-256 of the raw token —
 * changing the algorithm here silently invalidates every stored session.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
