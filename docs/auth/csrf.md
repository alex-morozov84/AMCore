# CSRF Posture

AMCore is a bearer-first API. Most routes authenticate with an explicit
`Authorization: Bearer ...` header, so they are not vulnerable to classic CSRF:
an attacker's page cannot cause the browser to invent that header.

The only ambient browser credential is the `refresh_token` cookie.

## What is actually in scope

Cookie-backed browser surfaces are intentionally narrow:

- `POST /auth/logout`
- `POST /auth/refresh`
- `POST /auth/oauth/exchange`
- Bull Board at `/admin/queues`

The refresh cookie is `httpOnly` and `SameSite=Strict`, so browsers do not send it
on normal cross-site requests. That is the primary CSRF layer.

## Why AMCore does not use blanket CSRF middleware

Blanket CSRF middleware across the whole API would mostly wrap bearer-only routes
that do not use ambient credentials. It would add integration friction without
covering a real threat. AMCore instead protects only the cookie-auth browser
surfaces.

## Second layer on cookie POST routes

AMCore adds a narrow `Origin` / `Referer` check on the cookie-auth POST endpoints.

- Trusted origins come from `CORS_ORIGIN`.
- Matching is exact origin matching: `scheme://host[:port]`.
- `Origin` is checked first.
- If `Origin` is absent, the backend falls back to the origin portion of
  `Referer`.
- If both are absent, the request is allowed by design.

This allow-on-missing policy is a deliberate, **frontend-agnostic** choice, not a
Next.js-specific one. CSRF is a browser-only threat: it relies on the browser
auto-attaching the cookie, and browsers always send `Origin` on cross-origin POST
(and on same-origin non-GET). It follows that:

- A **plain React / SPA** frontend always sends `Origin` on its API calls, so the
  check fully enforces and the "both absent" branch is never reached.
- A request that carries the cookie but **no** `Origin`/`Referer` is necessarily a
  non-browser caller — SSR server-to-server, native/mobile, or CLI. Those cannot
  mount CSRF (they don't ride a victim's ambient cookie), so allowing them removes no
  protection, while blocking them would only break legitimate clients.

The enforced guarantee is therefore: **any browser cross-origin POST must come from an
allowlisted origin** — which is exactly the situation where cookie-CSRF is possible.

## Bull Board

Bull Board is not mounted in production unless explicitly enabled, and it is never
mounted on the `worker` HTTP role. If it is enabled, the secure default is
read-only mode; writable queue actions require explicit operator opt-in.

## OAuth note

OAuth has its own CSRF class: login CSRF / session swapping. A one-time server-side
`state` value is not enough unless it is also bound to the browser that initiated
the flow. AMCore therefore binds OAuth login/link state to a short-lived browser
cookie in addition to the server-side state record.

## Static analysis (CodeQL) false positives

The OAuth browser-binding nonce trips three CodeQL queries that are vetted false
positives — they are dismissed (reason: _false positive_), not real findings:

- **`js/insufficient-password-hash`** on `hashOAuthStateNonce` — the input is a
  256-bit cryptographically-random nonce, not a low-entropy password, so a fast
  SHA-256 is correct (a slow KDF defends only against brute-forcing guessable
  secrets). Same transform as `refresh-token-hash.ts`.
- **`js/clear-text-storage-of-sensitive-data`** on the `oauth_state` cookie — storing
  the raw nonce in the browser cookie _is_ the binding mechanism; the server keeps
  only its hash. Removing it would delete the protection.

The cookie-hardening queries (`js/client-exposed-cookie`, `js/clear-text-cookie`) are
_not_ dismissed: the cookie is set with an inline options literal so `httpOnly` and
`secure` (prod) are statically visible to the analyzer.
