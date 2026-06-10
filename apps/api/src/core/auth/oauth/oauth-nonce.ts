import { createHash, randomBytes } from 'crypto'

/**
 * Browser-binding nonce for the OAuth `state` flow (login CSRF / session-swap
 * defense, RFC 6749 §10.12 / RFC 6819 §5.3.5).
 *
 * The raw nonce is set as a short-lived `SameSite=Lax` cookie on the initiating
 * browser at `authorize`/`link`; only its hash is stored alongside the
 * server-side `state` record. On callback the cookie is re-hashed and compared,
 * so an attacker-initiated callback URL opened in a victim browser (which lacks
 * the matching cookie) is rejected. Lax — not Strict — because the callback is a
 * cross-site top-level redirect from the provider and Strict would drop it.
 */
export function generateOAuthStateNonce(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hash for at-rest storage; never persist the raw nonce. */
export function hashOAuthStateNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}
