import 'server-only'

/**
 * Apple's `oauth_state_apple` binding cookie is set by the backend scoped to
 * its own callback path (`oauth-binding-cookie.ts`'s `APPLE_CALLBACK_PATH`),
 * not `path: '/'` like every other provider's `oauth_state`. Once the OAuth
 * init/callback legs are proxied through the frontend's own origin (Option
 * B, `ai/models-talk.md` "Iteration 2, slice 4"), a `Set-Cookie` relayed
 * byte-for-byte would carry that backend-only path — a path that doesn't
 * exist on the frontend — so the browser would never send the cookie back
 * on the frontend's own callback request. Rewriting `Path=` here is what
 * makes the relayed cookie actually ride along.
 */
const APPLE_BACKEND_CALLBACK_PATH = '/api/v1/auth/oauth/apple/callback'
const APPLE_FRONTEND_CALLBACK_PATH = '/api/auth/oauth/apple/callback'

const FORM_POST_PROVIDERS = new Set(['apple'])

function getSetCookieHeaders(response: Response): string[] {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter((value): value is string => value !== null)
}

/** Rewrites only the `Path` attribute; every other attribute (value, flags,
 * `Max-Age`/`Expires`) is passed through unchanged. */
function rewriteApplePath(setCookieHeader: string): string {
  const parts = setCookieHeader.split(';')
  const rewritten = parts.map((part) => {
    const [rawKey] = part.split('=')
    if (rawKey?.trim().toLowerCase() !== 'path') return part
    return part.replace(APPLE_BACKEND_CALLBACK_PATH, APPLE_FRONTEND_CALLBACK_PATH)
  })
  return rewritten.join(';')
}

/**
 * Appends every `Set-Cookie` header from an upstream `apps/api` response
 * onto an outgoing browser-facing `Headers`, rewriting Apple's
 * callback-scoped cookie path so it survives the origin change. Used by both
 * OAuth proxy legs (init sets the binding cookie, callback clears it) — see
 * `oauth-provider-proxy.ts`.
 */
export function relayOAuthCookies(upstream: Response, provider: string, target: Headers): void {
  const needsPathRewrite = FORM_POST_PROVIDERS.has(provider)
  for (const header of getSetCookieHeaders(upstream)) {
    target.append('set-cookie', needsPathRewrite ? rewriteApplePath(header) : header)
  }
}

export function isFormPostProvider(provider: string): boolean {
  return FORM_POST_PROVIDERS.has(provider)
}
