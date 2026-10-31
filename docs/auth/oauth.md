# OAuth — Social Login & Account Linking

OAuth lets users sign in with accounts they already trust — Google, GitHub, Apple, or Telegram — without creating a separate password for ordinary unprotected accounts. Protected
accounts must also prove their local password and app or backup code. MFA requires the separately approved
[deployment activation](mfa-deployment.md).

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

The table describes API/provider capability. The ordinary site login continues to
offer Google; product administration can offer configured Google, GitHub and Apple.
Ordinary admin login requires an existing account; invitation-bound signup can
create an account before membership, including when public signup is closed.
Membership and permissions are checked when the account opens a protected resource.

### Separate administration callbacks

Keep the same provider client/application identity for site and administration.
Register both exact browser callback URLs in that application's allowed URLs:
`https://shop.example.com/api/auth/oauth/google/callback` and
`https://manage.shop.example.com/api/product-admin/auth/oauth/google/callback`.
The existing `GOOGLE_CALLBACK_URL`, `GITHUB_CALLBACK_URL` and `APPLE_CALLBACK_URL`
remain the website callbacks. Admin callbacks are derived from
`PRODUCT_ADMIN_ORIGIN` and `/api/product-admin/auth/oauth/<provider>/callback`;
there is no separate admin client ID, secret or callback override.
GitHub.com supports multiple callback URLs in one OAuth application; see its
[registration update](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/).
Register exact URLs and disable wildcard matching. If a provider registration
cannot admit both URLs, resolve that registration before exposing admin OAuth;
do not substitute another client identity or forward cookies between hosts.
Replace `google` with the selected provider; Apple uses POST form_post. In path
mode both callbacks use the website origin, with the same distinct API prefixes.
The subsequent page callback is `/ru/manage/auth/callback` in path mode, or
`/ru/auth/callback` on the admin host. Do not register that page as the provider callback.

Telegram remains link-only. Its website `TELEGRAM_CALLBACK_URL` uses
`{FRONTEND_URL}/api/auth/oauth/telegram/callback`. Staff linking derives
`{PRODUCT_ADMIN_ORIGIN}/api/product-admin/auth/oauth/telegram/callback` in host
mode; path mode uses the website origin with that admin API prefix. Start linking
from the selected signed-in account. Do not add Telegram as a standalone login.

State and exchange tickets bind frontend, placement, callback, exact browser attempt
and allowlisted return destination. Login callbacks capture an account-version snapshot and create no session,
including invitation-bound login. Admin uses separate nonce/temporary cookies;
Apple's cross-site POST cookie remains restricted to its exact callback path.
GitHub sends S256 PKCE on new starts; pre-upgrade state retains its old exchange
contract until drained. Do not transfer a product cookie/token through a redirect.
Linking authenticates the selected account when the link starts. A protected
account also needs fresh local password and second-factor proofs. Its one-time
state retains the original family, security version and browser binding. The
callback rechecks that authority before committing attachment. Successful protected
linking requires a new sign-in; see [linking consequences](#after-successful-linking).
Revocation, expiry or a browser change refuses the link; a newer session cannot
replace the original authority. Telegram is link-only. See [placement and sessions](../product-admin/placement-and-sessions.md)
for hostname isolation, old links and coordinated deployment.

The signed Apple protocol fixture exercises the real OIDC client and provider
against discovery without UserInfo. It checks bad signatures, issuer/audience,
expiry and malformed claims. It does not prove browser publication or live Apple
client registration; those checks remain distinct.

### Apple identity verification

Apple publishes token and signing-key endpoints, but no UserInfo endpoint.
AMCore builds the Apple profile from the identity token returned by code exchange.
The OAuth library requires that token and verifies its signature, issuer, client
audience and expiry before AMCore reads its claims. Plain JWT decoding is insufficient.
The signing algorithm follows Apple discovery and the library policy.

The profile uses the verified subject and optional email. Both boolean and string
forms of `email_verified` are normalized; the string `"false"` is unverified.
An absent email cannot satisfy an invitation's verified-email requirement.
The first `form_post` may also contain a display name. That name is display data,
not proof of identity. State, browser binding, PKCE and invitation checks still apply.

Sources: [Apple discovery](https://appleid.apple.com/.well-known/openid-configuration)
and [identity verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user).

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
   - Captures account identity and security version, without creating a session
   - Issues a one-time login ticket bound to a short-lived browser nonce
   │
   ▼
7. Redirects to frontend:
   https://amcore.dev/{locale}/auth/callback?ticket=...
   + sets a60-second HttpOnly callback-binding nonce in refresh_token
   │
   ▼
8. Frontend exchanges ticket:
   POST /api/v1/auth/oauth/exchange
   Cookie: refresh_token
   Body: { "ticket": "..." }
   │
   ▼
9. Backend validates ticket + callback nonce + current account version
   Ordinary API clients receive credentials. Browser clients and protected
   accounts receive202 with a restricted continuation, without ordinary access.
```

**PKCE** (Proof Key for Code Exchange) prevents authorization code interception attacks. The `code_verifier` is never sent to the browser — only the hash goes to the provider.

**State** is a one-time server-side nonce stored in Redis. In AMCore it is paired
with a short-lived browser binding cookie, so the callback is tied both to the
server-side flow state and to the browser that started the login/link flow. When Redis does not
answer in time the state and ticket steps answer `503`; see
[Authentication when Redis is slow or unavailable](redis-outage.md).

Exchange tickets contain 256 random bits. SHA-256 fingerprints correlate one-use tickets
with their retained browser attempt; they do not store or verify human passwords.
For direct API sessions, the HttpOnly/Strict refresh cookie carries a random 256-bit
session handle. The server stores its digest, not a password in that cookie.

**How `apps/web` adapts this (ADR-068).** The diagram above describes the
direct/native API transport. The reference web frontend uses its own
origin for browser requests and calls the API server-side. Provider authorization,
state, browser binding, PKCE and token verification still execute normally.

After a provider login callback, the browser briefly holds a callback-binding
nonce in a host-only HttpOnly/Strict cookie. It is not a refresh credential and
has no Session row. Site uses `refresh_token`; admin relays it as
`__Host-amcore_admin_oauth_refresh` with Secure and a60-second lifetime. No backend
credential enters JavaScript, rendered props, JSON, local storage or telemetry.
The completed session uses the selected opaque app cookie instead.

- Site `*_CALLBACK_URL` and the provider registration point to
  `{FRONTEND_URL}/api/auth/oauth/:provider/callback`. Admin callbacks use
  `{PRODUCT_ADMIN_ORIGIN}/api/product-admin/auth/oauth/:provider/callback` in host
  mode; path mode uses the website origin. Keep both registrations exact.
- Web start/callback routes proxy the API with redirects held server-side and
  relay its navigation/browser-binding cookies. Apple is POST-only; its separate
  SameSite=None/Secure nonce remains scoped to the exact frontend callback path.
- The localized final `/auth/callback?ticket=...` is a public completion document,
  at `/ru/manage/auth/callback` for path admin or `/ru/auth/callback` on staff.
  It validates the selected frontend and bounded ticket syntax without reading
  identity, consuming tickets, refreshing, recovering or clearing sessions.
- The document renders a native form and “Completing sign-in…” with one Continue
  button. A small client leaf submits once; the same button works without JS.
  This new same-origin submission can send the Strict temporary cookie, which
  may be withheld from the preceding cross-site redirect chain.
- The form posts ticket and supported locale only to `/api/auth/oauth/complete`
  or `/api/product-admin/auth/oauth/complete`. Literal routes accept POST only,
  with an8KiB urlencoded body budget and no duplicate/unknown fields. Host and
  exact non-null Origin, including port, are checked before any credential,
  recovery, cleanup or upstream effect. No Referer or missing-Origin fallback.
- The admitted server-side operation exchanges the one-use ticket with the
  matching callback nonce and exact pending browser attempt. It retains the
  continuation before requesting credentials and stages the selected vault before
  publication. Protected accounts continue on the MFA page with local password
  and second-factor requirements. A provider identity never proves local MFA.
  Every post-completion navigation is303. It clears the exact temporary cookie;
  persistent sessions on other hosts remain intact.

```text
Provider -> BFF callback -> public completion document (no auth effects)
                                |
                      native same-origin POST
                                |
                   ticket/attempt check -> restricted continuation
                                |
                     local proofs when required
                                |
                     pending vault -> publication ->303 destination
```

Only the completion GET document uses `Referrer-Policy: strict-origin`: Referer
contains the origin, without the ticket/path, and the native POST retains the
exact Origin. A native form under no-referrer would send Origin null and fail.
Completion POST responses/redirects and other secret routes keep no-referrer.
Do not restore the default strict-origin-when-cross-origin on the document: it
would send its full URL in same-origin Referer. Preserve nonce CSP/form-action
self, no-store and noindex; verify these policies through the public edge.

A ticket expires after60seconds. Missing initial callback nonce, expiry or definitive
rejection returns to the selected login with a localized error. Start a new login.
A lost ordinary publication response can recover only its already published app
cookie, within the retained journal deadline, using the same ticket hash, pending
cookie and actual browser anchor. This status path never repeats exchange or
publishes a pending family. An unrelated ticket cannot adopt the selected session.
If recovery fails, start a new login; do not automatically repeat credential work.
Invited login retains the exact invitation attempt with the neutral browser intent.
The exchange rechecks its recipient, generation, continuation and expiry. A
protected account must provide its local password and second factor. The combined
confirmation validates the pending session without granting ordinary rights first.
One transaction confirms the handoff and publishes the family. Lost-response
recovery requires the same pending browser intent, anchor and invitation owner;
it cannot issue a second family.
See [invitation recovery](invites.md). Accepting membership remains a separate step.

Source: `apps/web/src/shared/api/bff/oauth-provider-proxy.ts`,
`oauth-cookie-relay.ts`, `oauth-completion-handler.ts`, `oauth-exchange-handler.ts`.

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
- A60-second callback-binding nonce in the `refresh_token` cookie, not a session

The frontend should exchange the ticket with `POST /api/v1/auth/oauth/exchange`.
An ordinary independent client receives credentials. A browser client or protected
account receives202 and must complete its restricted continuation. Tokens never
appear in a URL.
(`apps/web`'s reference implementation does this exchange server-side — see the
ADR-068 note above — so its own browser-facing surface never sees this call at all.)

The ticket is single-use, stored in Redis under a SHA-256-derived key, and expires
after 60 seconds. The exchange also requires the `refresh_token` cookie and
verifies the callback nonce, exact browser attempt when present, and current
account-version snapshot. It does not adopt a different live session.

See [CSRF Posture](./csrf.md) for the broader bearer-first CSRF policy and why
OAuth login needs browser-bound state in addition to the server-side `state`
record.

Production deployments should avoid logging query strings for OAuth callback
routes, because callback URLs still contain short-lived login tickets.

> **Note:** On login, the backend searches for an existing user by `provider + providerId` first, then falls back to email matching. Linking an existing account by email requires the provider to verify that email. An unverified email claim cannot create that link. Protected accounts must attach a new provider from a locally confirmed signed-in session; verified provider email alone cannot create that attachment. Ordinary admin login cannot create a new account; a validated invitation can permit it.

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

The callback cookie binds the one-time identity ticket to this exchange; it does
not itself grant a session. An ordinary independent API client can receive the
credential response above. Protected accounts and private browser admission receive
`202` with a restricted continuation instead. Finish the required local proofs and
exact publication before using ordinary credentials; see
[password and publication transport](mfa-foundation.md#password-and-publication-transport).

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

Use this to dynamically show/hide OAuth buttons in the UI. The bundled
`apps/web` login/register pages do exactly that for Google: the button is
hidden unless this endpoint returns `"google"`, and the button links to the
same-origin BFF path `/api/auth/oauth/google` rather than to `apps/api`
directly.

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

1. Redis stores `mode: "link"` and the account ID. Protected linking also captures the original session authority with a five-minute deadline.
2. The callback attaches the provider without creating a session. Protected linking rechecks current authority and local proof freshness under the account lock.
3. Protected accounts return to the selected frontend's localized `/login?linked=google`.
   Ordinary accounts retain their linked-accounts destination. See the outcome below.

### After successful linking

For a protected account, provider attachment advances the account security version
and revokes previous sessions and pending continuations in the same transaction.
The source session is revoked too. Factor identity, accepted TOTP step and backup
codes remain unchanged. A failed transaction rolls both attachment and revocation
back. Replaying a consumed callback does not issue another session or renew proofs.

The callback returns to the selected frontend's login page. Sign in again and
complete the required local password and app or unused backup-code proof.
Linking creates no replacement session. An old browser/API session cannot refresh
or continue a pending action; another session cannot adopt that operation.
Ordinary unprotected linking keeps its existing session policy.

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
  - Protected success → revoke old authority → redirect to localized login
  - Ordinary success → existing linked-accounts destination
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

- New GitHub.com authorization starts use S256 PKCE; legacy pending states retain
  their earlier exchange contract until expiry. See the
  [GitHub authorization contract](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
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
    // Pass codeVerifier whenever this provider's authorization used PKCE.
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
      avatarSourceUrl: null,
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
  avatarSourceUrl: string | null // provider-hosted picture; copied once into our storage, never stored
  phone: string | null // Telegram only
}
```

The reference login flow stores the provider identity in `OAuthAccount`. It does not populate its optional provider-token columns. Calling provider APIs later needs a separate token-storage and permission design.

### Profile pictures

AMCore never stores or serves a provider picture URL. The API copies the provider picture once
into its own public storage (see [media](../media/README.md)), and only when a sign-in creates the
account or links this provider to an existing account by email. Linking a provider on purpose from
account settings does not copy. The user must have no avatar and the provider must return
`avatarSourceUrl`. The copy runs after the sign-in response is decided, so it adds
no sign-in latency. It is not retried: a failed copy leaves the user without an avatar, and the user
can upload one. A repeat sign-in never copies again, so an avatar the user removed stays removed,
and the copy never replaces an avatar the user uploaded.

The download is a server-side request to a URL that a third party supplied, so it is restricted:

- `https` only, on an explicit host allow-list (`*.googleusercontent.com`,
  `avatars.githubusercontent.com`), no credentials or custom port. Add a host in
  `oauth-avatar-source.ts` when a new provider returns a picture URL.
- No redirect is followed, the wait is limited to 5 seconds, and the body is read only up to the
  avatar upload size limit.
- Only JPEG, PNG and WebP are accepted. The media pipeline then checks the image content itself.

Each attempt logs one `oauth avatar rehost` line with the result (`stored`, `skipped`, `failed`) and
a failure class, never the URL.

---

## OAuth errors

| Code                            | HTTP | When                                                              |
| ------------------------------- | ---- | ----------------------------------------------------------------- |
| `OAUTH_STATE_INVALID`           | 400  | State missing, expired (>5 min), or already used                  |
| `OAUTH_PROVIDER_ERROR`          | 502  | Provider returned an error or unexpected response                 |
| `OAUTH_EMAIL_REQUIRED`          | 400  | Provider didn't return an email and no existing account was found |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400  | Provider is not set up (missing env vars)                         |
| `OAUTH_ACCOUNT_ALREADY_LINKED`  | 409  | Linking: that provider account belongs to a different user        |

## Public signup and invited sign-in

`AUTH_PUBLIC_SIGNUP_ENABLED=false` prevents creation of new ordinary OAuth
accounts while preserving existing-account login. A validated invitation can
permit new-account creation for the matching canonical provider email. Provider
email/linking verification rules apply; Telegram remains link-only. OAuth callback
never grants organization membership: a verified recipient explicitly accepts
the inspected invitation afterwards.

A dedicated server BFF can start invited OAuth with a scoped continuation and
paired authentication handoff proof. The one-time API state stores attempt,
provider, invitation ID/generation, continuation deadline and cleanup-key hash
alongside existing PKCE/browser binding. These fields never enter the provider
URL. Validated callback carries correlation into the one-time login ticket;
exchange returns optional `invitation` metadata with the exact backend session ID.
It is server correlation, never a browser-chosen return destination.

The new session is pending until the BFF receives its matching browser cookie
and explicitly confirms the authentication handoff. Failed publication can abort
only that unconfirmed session; a database-only deadline sweep provides cleanup
when Redis is unavailable. See [invitation authentication](invites.md#scoped-signup-and-authentication)
for headers, endpoints, deadlines and recovery. Ordinary OAuth retains its
existing destinations and cookie/nonce/ticket protections.
