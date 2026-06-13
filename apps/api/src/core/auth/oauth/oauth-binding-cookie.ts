import type { Request, Response } from 'express'

/**
 * OAuth browser-binding cookie (login-CSRF / session-swap defense, RFC 6749
 * §10.12 / RFC 6819 §5.3.5). The raw nonce is the double-submit value; only its
 * SHA-256 is stored alongside the server-side `state` (see `oauth-nonce.ts`).
 *
 * Each control does a distinct job — none is redundant: the single-use server
 * `state` gives request/callback correlation and replay resistance; **this
 * cookie is the load-bearing control that binds that state to the browser that
 * initiated the flow**, which is what actually stops login-CSRF / session-swap
 * (an attacker-initiated callback opened in a victim browser lacks the matching
 * nonce); PKCE, where the provider supports it, protects the code redemption.
 * Do not drop this cookie thinking `state`+PKCE already cover its job.
 *
 * Two cookie shapes by transport:
 * - **Most providers** return via a top-level GET redirect, so a `SameSite=Lax`
 *   cookie at `path=/` rides along (Strict would be dropped on the cross-site
 *   redirect).
 * - **Apple** uses `response_mode=form_post`, so the callback is a cross-site
 *   POST, which does NOT send a Lax/Strict cookie. Apple needs its own
 *   `SameSite=None; Secure` cookie — but scoped to ONLY the Apple callback path
 *   and short-lived/single-use, so the broadened SameSite stays as narrow as
 *   possible (ADR-047 narrow-CSRF posture: narrowness = path + lifetime +
 *   single-use, not SameSite breadth).
 *
 * Distinct cookie NAMES per transport on purpose: a single `oauth_state` reused
 * at both `path=/` and the callback path would leave two cookies the browser
 * sends together (ambiguous read) and a `clearCookie(path:'/')` could not clear
 * the path-scoped one.
 */
const DEFAULT_COOKIE = 'oauth_state'
const APPLE_COOKIE = 'oauth_state_apple'
const APPLE_CALLBACK_PATH = '/api/v1/auth/oauth/apple/callback'
const MAX_AGE_MS = 5 * 60 * 1000 // matches the OAuth state TTL

/**
 * The single source of truth for which providers use `response_mode=form_post`
 * (cross-site POST callback). The controller gates its GET/POST callback
 * transports on this, and the binding-cookie shape is selected from it.
 */
export function isFormPostProvider(provider: string): boolean {
  return provider === 'apple'
}

export function setOAuthBindingCookie(
  res: Response,
  provider: string,
  nonce: string,
  isProduction: boolean
): void {
  // Inline literal options so `httpOnly`/`secure` are statically visible at the
  // `res.cookie` sink — CodeQL cannot resolve flags supplied via a getter and
  // would otherwise raise false `js/client-exposed-cookie` alerts.
  //
  // CodeQL also raises `js/clear-text-storage-of-sensitive-data` (CWE-312) here:
  // a vetted false positive (mirrors the dismissed alert on the prior
  // controller location). The nonce is a 256-bit random, single-use,
  // 5-minute browser-binding value that is INTENDED to be the cookie value —
  // it is the double-submit half (the server persists only its SHA-256, see
  // `oauth-nonce.ts`). It is not a credential at rest; this is the standard
  // CSRF-token-in-cookie pattern, set HttpOnly + Secure.
  if (isFormPostProvider(provider)) {
    // `SameSite=None` REQUIRES `Secure` (browsers reject `None` without it), so
    // this cookie is always Secure — not tied to NODE_ENV. localhost is exempt
    // from the HTTPS *transport* rule but still accepts the `Secure` *attribute*,
    // so dev works; a plain-HTTP non-local callback simply cannot run Apple,
    // which matches Apple's HTTPS return-URL requirement.
    res.cookie(APPLE_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: APPLE_CALLBACK_PATH,
      maxAge: MAX_AGE_MS,
    })
    return
  }

  res.cookie(DEFAULT_COOKIE, nonce, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  })
}

export function readOAuthBindingNonce(req: Request, provider: string): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined
  return isFormPostProvider(provider) ? cookies?.[APPLE_COOKIE] : cookies?.[DEFAULT_COOKIE]
}

export function clearOAuthBindingCookie(res: Response, provider: string): void {
  // clearCookie must use the same path the cookie was set with, or the browser
  // keeps it.
  if (isFormPostProvider(provider)) {
    res.clearCookie(APPLE_COOKIE, { path: APPLE_CALLBACK_PATH })
    return
  }
  res.clearCookie(DEFAULT_COOKIE, { path: '/' })
}
