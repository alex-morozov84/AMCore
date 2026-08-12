# OAuth — Social Login & Account Linking

OAuth lets users sign in with accounts they already trust — Google, GitHub, Apple, or Telegram — without creating a separate password.

---

## Supported providers

| Provider | Login | Link | Notes                                                      |
| -------- | ----- | ---- | ---------------------------------------------------------- |
| Google   | ✅    | ✅   | OIDC, PKCE, email + profile                                |
| GitHub   | ✅    | ✅   | OAuth 2.0, fetches verified primary email separately       |
| Apple    | ✅    | ✅   | OIDC, PKCE, `form_post` response, name only on first login |
| Telegram | ❌    | ✅   | Phone only, no email — can't be used for standalone login  |

**"Login"** — user can create an account or sign in using this provider alone.
**"Link"** — authenticated user can connect this provider to their existing account.

---

## How OAuth login works

The flow involves three parties: your app, the user's browser, and the OAuth provider.

```
1. User clicks "Sign in with Google"
   │
   ▼
2. GET /api/v1/auth/oauth/google
   Backend generates:
   - state   (random 32 bytes, stored in Redis for 5 min)
   - PKCE code_verifier (random 32 bytes)
   - PKCE code_challenge = SHA-256(code_verifier)
   │
   ▼
3. Browser redirects to Google:
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=...
     &redirect_uri=https://api.amcore.dev/api/v1/auth/oauth/google/callback
     &scope=openid email profile
     &state=<random>
     &code_challenge=<hash>
     &code_challenge_method=S256
   │
   ▼
4. User sees Google's consent screen, approves
   │
   ▼
5. Google redirects to:
   GET /api/v1/auth/oauth/google/callback?code=...&state=...
   │
   ▼
6. Backend:
   - Validates state (retrieves from Redis, deletes after use — one-time)
   - Exchanges code for tokens (with PKCE code_verifier)
   - Fetches user profile from ID token
   - Finds existing user by (provider + providerId) or email
   - Creates user if new
   - Creates session
   - Issues a one-time login ticket
   │
   ▼
7. Redirects to frontend:
   https://amcore.dev/{locale}/auth/callback?ticket=...
   + sets refresh_token cookie
   │
   ▼
8. Frontend exchanges ticket:
   POST /api/v1/auth/oauth/exchange
   Cookie: refresh_token
   Body: { "ticket": "..." }
   │
   ▼
9. Backend validates ticket + refresh session binding
   and returns { accessToken }
```

**PKCE** (Proof Key for Code Exchange) prevents authorization code interception attacks. The `code_verifier` is never sent to the browser — only the hash goes to the provider.

**State** is a one-time server-side nonce stored in Redis. In AMCore it is paired
with a short-lived browser binding cookie, so the callback is tied both to the
server-side flow state and to the browser that started the login/link flow.

**How `apps/web`'s reference implementation adapts this (ADR-068).** The
diagram above is this API's own contract — accurate for any client with its
own cookie jar (a mobile app, a different frontend). `apps/web` is a BFF: for
every other flow (login, register, an authenticated request), the browser
never holds a backend cookie or access token in any form — only its own
opaque `amcore_session`. OAuth has one narrow, deliberate exception to that.
Steps 2–3 and 5–7 above involve the browser hitting this API _directly_
(Google's `redirect_uri` is a fixed, provider-registered URL — it can't be
redirected through anything else), and step 7's `refresh_token` cookie is
host-only to whatever origin actually answered that request. `apps/web`
proxies those legs through its own origin (below) precisely so that cookie
lands scoped to the frontend instead of this API — which means, for the
few seconds between the callback landing and step 8's exchange completing,
the browser genuinely does hold that raw backend `refresh_token`, as a
normal (httpOnly, host-only) cookie in its jar. It is never readable by page
JS, it is single-purpose (bound to one just-issued, single-use ticket), and
`apps/web`'s exchange handler deletes it as its very next step — but it is
real, and this doc should say so rather than imply otherwise. Without this
proxying, `apps/web`'s server — on whatever origin the _unproxied_ callback
would have landed the cookie on — would never see it on the subsequent
request to `/{locale}/auth/callback`, and step 8's exchange would always
fail with `OAUTH_TICKET_INVALID`.

So `apps/web` proxies steps 2 and 5–7 through its own origin instead of
linking/registering this API's URLs directly:

- `*_CALLBACK_URL` (and the provider console's redirect URI) point at
  `{FRONTEND_URL}/api/auth/oauth/:provider/callback`, not this API.
- `apps/web`'s `GET /api/auth/oauth/:provider` and
  `GET|POST /api/auth/oauth/:provider/callback` forward the request to this
  API's equivalent endpoints below with `redirect: 'manual'`, then relay the
  response (`Location`, `Set-Cookie`, status) back to the browser unchanged —
  except Apple's `oauth_state_apple` cookie, whose `Path` gets rewritten from
  this API's callback path to the frontend's, since it's narrower than `/`
  and wouldn't otherwise survive the origin change.
- Step 8's exchange is `apps/web`'s own `/{locale}/auth/callback` Route
  Handler calling this API server-side — the request now legitimately carries
  the (frontend-origin-scoped) `refresh_token` cookie relayed above. It also
  fetches `GET /auth/me` for the profile, mints its Redis session-vault
  entry, sets its own `amcore_session` cookie, and clears the temporary
  `refresh_token` cookie — the browser never keeps it.

Source: `apps/web/src/shared/api/bff/oauth-provider-proxy.ts`,
`oauth-cookie-relay.ts`, `oauth-exchange-handler.ts`.

---

## Initiating OAuth login

**Endpoint:** `GET /api/v1/auth/oauth/:provider`

No body or auth required — just redirect the user's browser here.

```
GET /api/v1/auth/oauth/google
GET /api/v1/auth/oauth/github
GET /api/v1/auth/oauth/apple
```

The server redirects to the provider's consent screen. Your frontend just needs a link or button that points to this URL — in `apps/web`'s reference implementation, that's its own `/api/auth/oauth/:provider` proxy path (see the ADR-068 note above), not this URL directly.

---

## The callback

**Endpoint:** `GET /api/v1/auth/oauth/:provider/callback` (redirect/query providers)
or `POST /api/v1/auth/oauth/:provider/callback` (Apple `form_post`)

This is only called by the OAuth provider — not by your frontend directly. The backend handles the token exchange and then redirects the browser to your frontend.

Most providers (Google, GitHub, Telegram) return via a top-level **GET** redirect
with `code`/`state` in the query string. **Apple** uses `response_mode=form_post`
and **POSTs** `code`/`state` (plus, on first login only, a `user` JSON) as a
cross-site form body — so the backend exposes both a GET and a POST callback that
share one handler. A cross-site POST does not carry a `SameSite=Lax` cookie, so the
Apple browser-binding nonce rides a separate `SameSite=None; Secure` cookie scoped to
the Apple callback path; all other providers keep the `SameSite=Lax` `oauth_state`
cookie. Each control does a distinct job: the single-use server-side `state` gives
request/callback correlation and replay resistance, the **binding cookie ties that
state to the browser that started the flow** (this is what prevents login-CSRF /
session-swap), and PKCE — where the provider supports it — protects code redemption.

After a successful login, the frontend receives:

- A one-time login ticket in the query string: `?ticket=...`
- A `refresh_token` cookie

The frontend should exchange the ticket with `POST /api/v1/auth/oauth/exchange`.
The access token is returned in the response body and is never placed in a URL.
(`apps/web`'s reference implementation does this exchange server-side — see the
ADR-068 note above — so its own browser-facing surface never sees this call at all.)

The ticket is single-use, stored in Redis under a SHA-256-derived key, and expires
after 60 seconds. The exchange also requires the `refresh_token` cookie and
verifies that the ticket is bound to the same session.

See [CSRF Posture](./csrf.md) for the broader bearer-first CSRF policy and why
OAuth login needs browser-bound state in addition to the server-side `state`
record.

Production deployments should avoid logging query strings for OAuth callback
routes, because callback URLs still contain short-lived login tickets.

> **Note:** On login, the backend searches for an existing user by `provider + providerId` first, then falls back to email matching. This means if a user registered with their Google email and later uses "Sign in with Google", their accounts are linked automatically.

---

## Exchanging the login ticket

**Endpoint:** `POST /api/v1/auth/oauth/exchange`

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/oauth/exchange \
  -H "Content-Type: application/json" \
  --cookie "refresh_token=..." \
  -d '{"ticket":"..."}'
```

```json
{
  "accessToken": "eyJhbGci..."
}
```

The refresh token is not rotated by this endpoint. It is only validated to bind
the ticket to the session created during the OAuth callback.

---

## List available providers

**Endpoint:** `GET /api/v1/auth/oauth/providers`

Returns only the providers that are configured (have valid env vars):

```bash
curl https://api.amcore.dev/api/v1/auth/oauth/providers
```

```json
{
  "providers": ["google", "github", "apple", "telegram"]
}
```

Use this to dynamically show/hide OAuth buttons in the UI.

---

## Account linking

Account linking lets an authenticated user connect additional OAuth providers to their account. After linking, they can sign in with any of their connected providers.

### When to use linking

- User registered with email+password, now wants to add "Sign in with Google"
- User signed in with Google, wants to also connect their GitHub
- Adding Telegram to get phone verification

### How to link

**Endpoint:** `GET /api/v1/auth/oauth/:provider/link`

Requires a valid JWT — the user must already be logged in.

```bash
# Redirect the user's browser to this URL with the Authorization header
# In practice, the frontend just navigates to this URL while the user is authenticated
GET /api/v1/auth/oauth/google/link
Authorization: Bearer eyJhbGci...
```

The flow is identical to regular OAuth login, except:

1. The state stored in Redis includes `mode: "link"` and the user's `userId`
2. After the callback, instead of creating a session, the provider is attached to the user
3. The user is redirected to `/{locale}/settings/linked-accounts?linked=google`

### Linking flow

```
Authenticated user wants to link GitHub
│
▼
GET /api/v1/auth/oauth/github/link  (with Bearer token)
Backend stores: { mode: "link", userId: "cm1abc...", provider: "github", ... }
│
▼
User sees GitHub consent screen
│
▼
Callback: /api/v1/auth/oauth/github/callback
Backend:
  - mode == "link" → attach GitHub account to user "cm1abc..."
  - If GitHub account is already linked to a DIFFERENT user → error
  - Success → redirect to /{locale}/settings/linked-accounts?linked=github
```

**Errors:**

| Code                           | HTTP | When                                                    |
| ------------------------------ | ---- | ------------------------------------------------------- |
| `OAUTH_ACCOUNT_ALREADY_LINKED` | 409  | That provider account is already linked to another user |

---

## Provider-specific notes

### Google

- Uses OIDC discovery (auto-fetches config from `accounts.google.com`)
- Scopes: `openid email profile`
- Email is always provided and verified
- Required env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`

### GitHub

- GitHub doesn't support PKCE — uses standard OAuth 2.0
- Scopes: `read:user user:email`
- Email may not be in the main profile response — the backend makes a second call to `/user/emails` to find the verified primary email
- Required env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`

### Apple

Apple is the most complex provider due to Apple's strict requirements.

- Uses OIDC with PKCE
- Response mode is `form_post` — Apple **POSTs** back to the callback (not a GET
  redirect). The backend handles this on `POST /api/v1/auth/oauth/apple/callback`;
  browser binding uses a dedicated `SameSite=None; Secure` cookie (see [The callback](#the-callback))
- The client secret is a JWT that must be **generated dynamically** (not a static string)
- **Name is only sent on the very first authorization,** in the form_post `user`
  field (never in the ID token or userinfo). The backend reads it on first login and
  stores it as the display name; later logins reuse the stored name.
- Required env: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL`

### Telegram

Telegram is link-only because it doesn't provide an email address — only a phone number.

- Uses OIDC: scopes `openid phone`
- The phone number comes from the ID token as `phone_number`
- When linking, the phone is saved to the user's `phone` field (globally unique)
- Can't be used for standalone registration — you'd have no email for notifications
- Required env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`

---

## Adding a new provider

Adding a provider (Microsoft, Discord, GitLab, …) is a self-contained extension:
implement one interface, register it behind config, and declare its env vars. The
shared machinery — one-time `state`, PKCE, the browser-binding cookie, the login
ticket, and account linking — is owned by `OAuthService` and applies to every
provider automatically. **A provider never touches those controls;** it only
builds URLs, exchanges the code, and normalizes the profile.

**1. Implement `OAuthProvider`** in
[`core/auth/oauth/providers/<name>.provider.ts`](../../apps/api/src/core/auth/oauth/providers/).
The interface
([`oauth-provider.interface.ts`](../../apps/api/src/core/auth/oauth/providers/oauth-provider.interface.ts))
is three methods; [`github.provider.ts`](../../apps/api/src/core/auth/oauth/providers/github.provider.ts)
is the smallest reference:

```ts
export class DiscordProvider implements OAuthProvider {
  readonly name = 'discord'
  constructor(private readonly config: OAuthProviderConfig) {}

  getAuthorizationURL(state: string, codeVerifier: string): Promise<URL> {
    const url = new URL('https://discord.com/oauth2/authorize')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'identify email')
    url.searchParams.set('state', state) // state is generated for you — just echo it
    // If the provider supports PKCE, derive the challenge from codeVerifier:
    //   url.searchParams.set('code_challenge', sha256Base64Url(codeVerifier))
    //   url.searchParams.set('code_challenge_method', 'S256')
    return Promise.resolve(url)
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    // POST to the token endpoint; throw AppException(..., OAUTH_PROVIDER_ERROR) on failure.
    // Pass codeVerifier only if the provider does PKCE (GitHub ignores it).
    return { accessToken: '...' }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    // Fetch the provider's userinfo and normalize to the shared profile shape.
    return {
      providerId: '...', // the provider's stable internal user id — never the email
      provider: 'discord',
      email: '...', // or null if the provider returns none (see login vs link-only)
      emailVerified: true,
      displayName: '...',
      avatarUrl: null,
    }
  }
}
```

`OAuthTokens` and `OAuthUserProfile` are the shared contracts in
[`packages/shared`](../../packages/shared/src) — every provider normalizes to the
same profile shape ([What user data is collected](#what-user-data-is-collected)),
so nothing downstream is provider-specific.

**2. Register it behind config** in
[`oauth-provider.factory.ts`](../../apps/api/src/core/auth/oauth/providers/oauth-provider.factory.ts).
Add a `tryRegister…()` that reads the env vars and **registers only when they are
all present**, then call it from `registerProviders()`. This is what makes the
provider config-driven: an unconfigured provider is simply absent from
`GET /auth/oauth/providers`, and requesting it returns
`400 OAUTH_PROVIDER_NOT_CONFIGURED` from the factory (the `:provider` route
param is validated there — no separate allowlist to update). If the provider
uses `response_mode=form_post`, also add it to `isFormPostProvider()` in
[`oauth-binding-cookie.ts`](../../apps/api/src/core/auth/oauth/oauth-binding-cookie.ts)
so the POST callback and `SameSite=None` browser-binding cookie are selected.

**3. Declare the env vars** in the env schema's OAuth section
([`oauth.env.ts`](../../apps/api/src/env/schema/oauth.env.ts)): add the keys as
`optionalEnvString()` / `optionalEnvUrl()`. Then add a `requireAllIfAny('Discord
OAuth', [...])` group in
[`provider-rules.ts`](../../apps/api/src/env/schema/refinements/provider-rules.ts)
so a partially-configured provider fails fast at startup rather than at the first
login. Mirror them in [`.env.example`](../../.env.example).

**Login vs link-only.** A provider that cannot return an email (as with Telegram)
**cannot back standalone login** — the callback resolves `OAUTH_EMAIL_REQUIRED`
when no email and no existing linked account are found. Such providers are
link-only. Everything else — one-time `state`, the browser-binding cookie that
prevents login-CSRF, PKCE where supported, and the single-use login ticket — is
enforced centrally and needs no per-provider code. Add a provider spec alongside
the implementation (the existing `*.provider.spec.ts` files are the pattern).

## What user data is collected

All providers are normalized to the same profile shape before the user record is created or updated:

```typescript
{
  providerId: string // Provider's internal user ID
  provider: string // "google" | "github" | "apple" | "telegram"
  email: string | null // null for Telegram
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
  phone: string | null // Telegram only
}
```

The raw OAuth tokens (provider access token, refresh token) are stored in `OAuthAccount` and can be used later for provider-specific API calls (e.g., Google Calendar, GitHub repos).

---

## OAuth errors

| Code                            | HTTP | When                                                              |
| ------------------------------- | ---- | ----------------------------------------------------------------- |
| `OAUTH_STATE_INVALID`           | 400  | State missing, expired (>5 min), or already used                  |
| `OAUTH_PROVIDER_ERROR`          | 502  | Provider returned an error or unexpected response                 |
| `OAUTH_EMAIL_REQUIRED`          | 400  | Provider didn't return an email and no existing account was found |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400  | Provider is not set up (missing env vars)                         |
| `OAUTH_ACCOUNT_ALREADY_LINKED`  | 409  | Linking: that provider account belongs to a different user        |
