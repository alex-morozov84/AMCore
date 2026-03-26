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
   - Creates session, issues tokens
   │
   ▼
7. Redirects to frontend:
   https://amcore.dev/auth/callback?token=eyJhbGci...
   + sets refresh_token cookie
   │
   ▼
8. Frontend stores access token, redirects to dashboard
```

**PKCE** (Proof Key for Code Exchange) prevents authorization code interception attacks. The `code_verifier` is never sent to the browser — only the hash goes to the provider.

**State** is a random nonce stored server-side in Redis. It ties the initial request to the callback, preventing CSRF attacks.

---

## Initiating OAuth login

**Endpoint:** `GET /api/v1/auth/oauth/:provider`

No body or auth required — just redirect the user's browser here.

```
GET /api/v1/auth/oauth/google
GET /api/v1/auth/oauth/github
GET /api/v1/auth/oauth/apple
```

The server redirects to the provider's consent screen. Your frontend just needs a link or button that points to this URL.

---

## The callback

**Endpoint:** `GET /api/v1/auth/oauth/:provider/callback`

This is only called by the OAuth provider — not by your frontend directly. The backend handles the token exchange and then redirects the browser to your frontend.

After a successful login, the frontend receives:

- An access token in the query string: `?token=eyJhbGci...`
- A `refresh_token` cookie

The frontend should extract the token from the URL, store it, and redirect to the dashboard.

> **Note:** On login, the backend searches for an existing user by `provider + providerId` first, then falls back to email matching. This means if a user registered with their Google email and later uses "Sign in with Google", their accounts are linked automatically.

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
3. The user is redirected to `/settings/linked-accounts?linked=google`

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
  - Success → redirect to /settings/linked-accounts?linked=github
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
- Response mode is `form_post` — Apple POSTs back to the callback (not GET redirect)
- The client secret is a JWT that must be **generated dynamically** (not a static string)
- **Name is only sent on the very first authorization.** If you miss it, it's gone. Store it immediately.
- Required env: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL`

### Telegram

Telegram is link-only because it doesn't provide an email address — only a phone number.

- Uses OIDC: scopes `openid phone`
- The phone number comes from the ID token as `phone_number`
- When linking, the phone is saved to the user's `phone` field (globally unique)
- Can't be used for standalone registration — you'd have no email for notifications
- Required env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`

---

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
