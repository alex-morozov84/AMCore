# Secret Rotation

Every secret this starter reads through `EnvService` will eventually need to be
rotated — a suspected leak, an employee/contractor offboarding, or plain
periodic hygiene. This guide covers what actually happens in AMCore's own code
and infrastructure when you rotate each class of secret: what breaks, what
doesn't, and how to bound or avoid a maintenance window. It assumes you've
already set up [production DB role separation](database-role-separation.md)
and read the [production deploy profile](production-deploy-profile.md)'s
secrets checklist — this guide is about changing a secret's _value_ after it's
already in place, not provisioning it the first time.

**Scope.** Every secret `EnvService` reads, grouped by how rotating it
actually behaves: `JWT_SECRET`, database credentials, `REDIS_URL`, OAuth
provider secrets (including Apple's key-pair shape), third-party API keys
(email, storage, AI providers), and the **two-sided** secrets shared with an
external party — webhook signing secrets and the metrics scrape token — whose
rotation isn't unilateral the way the others are. Not covered: rotating the
audit-log or session-cookie signing mechanism (there isn't one — sessions are
server-side, identified by an opaque cookie value looked up in
Redis/Postgres, not a signed token) or TLS certificates (your reverse
proxy/ACME client's job, not this app's).

## JWT_SECRET

**There is no `kid` (key ID) support in this codebase** — `auth.module.ts`
wires exactly one `JWT_SECRET` into `JwtModule`, with no second
verification key and no key-ring. Products that need instant, zero-visible-error
JWT rotation do it by accepting multiple signing keys at once (a `kid` claim in
the token header selects which key verifies it), which lets you add a new key,
migrate signing to it, and only then drop the old one. AMCore doesn't have that
mechanism today — this is a deliberate, tracked gap, not an oversight, and
this guide documents the single-secret rotation that's actually possible with
the code as it exists.

### What actually breaks, verified against the real request path

Rotating `JWT_SECRET` does **not** force every user to log in again, but it
**does** produce real, visible errors for a bounded window — tracing the
request path shows why both halves are true:

- **Access tokens are short-lived signed JWTs** (`token.service.ts`,
  `JwtService.sign`/`verify`), TTL `JWT_ACCESS_EXPIRATION` (default `15m`).
  Any token signed with the _old_ secret fails signature verification on the
  API the instant you rotate — there's no grace period.
- **Refresh tokens are not JWTs.** `TokenService.generateRefreshToken()` is a
  `randomBytes(32)` hex string; `SessionService` looks it up by its hash in
  the `Session` table (`findByRefreshToken`/`rotateRefreshToken`). Refresh
  validity is a database lookup, completely independent of `JWT_SECRET`. This
  is why nobody needs to re-enter credentials: rotating the JWT secret cannot
  invalidate a refresh token.
- **The BFF's proactive refresh is time-based, not signature-based.**
  `ensureFreshSession()` (`apps/web/src/shared/api/bff/ensure-fresh-session.ts`)
  decides whether to refresh purely from `accessTokenExpiresAt` recorded in the
  Redis session vault at mint time, with a 30s safety margin
  (`REFRESH_SAFETY_MARGIN_MS`). It has no way to know the signing secret
  changed server-side, so it keeps serving an old-secret access token as
  "fresh" until that token's own recorded expiry — up to the full
  `JWT_ACCESS_EXPIRATION` after the rotation, not from the rotation event.
- **Nothing retries a 401 from the API and re-authenticates.**
  `proxyToBackend()` (`authenticated-proxy.ts`) forwards the request to
  `apps/api` exactly once and passes back whatever status it gets, 401
  included. TanStack Query's own retry policy
  (`apps/web/src/shared/api/query-client.ts`) explicitly does not retry any
  4xx except 429. There is no global "401 → force refresh → force logout"
  handler in this codebase today.

**Net effect, verified by tracing this exact path — but only if the secret
change is atomic across every `api` process:** for up to
`JWT_ACCESS_EXPIRATION` after rotation (default 15 minutes), a user whose
access token was minted before the rotation sees real, user-visible 401s on
whatever they're doing — not a silent, self-healing blip. Once that specific
session's token would have expired anyway, its next proactive refresh mints a
new access token signed with the new secret using the still-valid refresh
token, and it recovers on its own — no re-login required, ever.

**That guarantee breaks under a rolling restart specifically — unlike every
other secret in this guide, JWT_SECRET must not be rotated that way.** A
rolling restart means some `api` replicas verify against the old secret and
some against the new one, simultaneously, for as long as the rollout takes.
Verification is per-request against whichever replica happens to answer it,
so during that window: a pre-rotation access token succeeds or fails
depending only on which replica it lands on, and — this is the part a rolling
restart's usual "the old thing keeps working until it's replaced" story
doesn't cover — a **post-rotation** access token, freshly minted by an
already-restarted replica, also gets rejected by every replica still running
the old secret. Nothing here retries a 401 (verified above), so this isn't
masked; it surfaces as real, flaky failures for the entire rollout, not just
the `JWT_ACCESS_EXPIRATION` window the paragraph above promises. That promise
only holds once every replica is simultaneously on the new secret.

### Rotation procedure

1. Generate a new secret (`openssl rand -base64 48` or equivalent — the
   existing `JWT_SECRET: z.string().min(32, ...)` constraint is a floor, not a
   target).
2. Pick your exposure-window strategy:
   - **Accept the default window.** Rotate during a low-traffic period. Every
     currently-active session recovers on its own within
     `JWT_ACCESS_EXPIRATION` (15 minutes by default) with no action from the
     user beyond retrying whatever failed.
   - **Shrink the window first, using only the existing env var — no code
     change.** Some time before the planned rotation (at least one full
     `JWT_ACCESS_EXPIRATION` in advance), lower `JWT_ACCESS_EXPIRATION` (e.g.
     to `2m`) and redeploy. Wait out the _old_ TTL so every live access token
     was minted under the new, short TTL. Rotate `JWT_SECRET`. The exposure
     window is now bounded by the shortened TTL instead of the default one.
     Restore `JWT_ACCESS_EXPIRATION` afterward if you don't want the extra
     refresh traffic permanently.
   - **Force everyone to re-authenticate immediately instead of waiting.**
     There's no built-in admin action for this — an operator with direct
     database access runs `DELETE FROM core.sessions;` (or the equivalent
     `prisma.session.deleteMany()` from a one-off script) at the moment of
     rotation. This trades "up to 15 minutes of intermittent 401s" for one
     immediate, clean, single logout event for every user — a legitimate
     choice if that's a better UX for your product than flaky partial
     failures, but it is a much larger blast radius than the default (every
     session, not just ones that happen to hit an endpoint in the next 15
     minutes) and needs its own maintenance
     communication.
3. Deploy the new `JWT_SECRET` with an **atomic cutover, not a rolling
   restart** — the only secret in this guide where rolling is the wrong
   answer instead of the safe default. Use one of:
   - **Blue-green** ([Deployment & migrations —
     blue-green](deployment.md#zerolow-downtime-rollout--stated-honestly)):
     stand up the new stack with the new secret, verify it, then flip the
     reverse proxy's upstream in one move. Every request is served by the old
     secret until the flip and the new secret after it — no mixed population,
     and no added downtime beyond the flip itself.
   - **A simultaneous full restart** of every `api`/`worker` replica at once
     (e.g. `docker compose up -d --force-recreate api worker`, or a
     `Recreate` rather than `RollingUpdate` strategy) if you don't have
     blue-green set up. This trades a brief, honest total outage (the same
     gap [Zero/low-downtime rollout — stated
     honestly](deployment.md#zerolow-downtime-rollout--stated-honestly)
     already describes for plain `docker compose up -d`) for atomicity — a
     better trade here than a rolling restart's _longer_, silently-flaky
     failure window across both token generations.
4. Confirm: a fresh login mints and verifies correctly; an access token
   captured before the rotation now gets 401 from the API when reused
   directly (e.g. via `curl`) — the expected, verified behavior above, not a
   bug.

## Database credentials (`amcore_migrator` / `amcore_runtime`)

Builds on [production DB role separation](database-role-separation.md) — if
you haven't split these roles yet, do that first; a single shared DB role has
no rotation story better than "change the password and restart everything at
once."

**Verified against a real Postgres 16 container:** an `ALTER ROLE ... PASSWORD`
statement does **not** affect connections that are already established and
authenticated — a session opened with the old password keeps running new
queries successfully for its entire lifetime. Only a _new_ connection attempt
is checked against the current password. This is the mechanic that makes a
rolling restart the actual rotation primitive here, not a special feature of
this starter:

1. Generate new passwords for `amcore_migrator` and `amcore_runtime`.
2. `ALTER ROLE amcore_runtime PASSWORD '<new>';` and the same for
   `amcore_migrator`. Every pooled connection any currently-running `api`/
   `worker` replica already holds keeps working, unaffected, verified above —
   this step alone causes no errors anywhere.
3. Update `DATABASE_URL` (runtime role) and `MIGRATION_DATABASE_URL` (migrator
   role) in your secret store.
4. Roll the `api`/`worker` processes (see [Zero/low-downtime
   rollout](deployment.md#zerolow-downtime-rollout--stated-honestly) — the
   same rolling-restart pattern deploys of new code already use). Each replica
   picks up the new connection string only when it restarts and opens fresh
   pool connections; there is no window where every connection is
   simultaneously invalid, because old replicas keep their already-open
   connections until they're individually recycled.
5. `MIGRATION_DATABASE_URL`'s new value only matters at the next
   `prisma migrate deploy` — that step doesn't run continuously, so there's no
   "in-flight migrator connection" case to worry about the way there is for
   the long-lived runtime pool.

Postgres has no equivalent to Redis ACL's or AWS IAM's "two valid credentials
at once" — a role has exactly one password. The rolling-restart property above
is what stands in for that here: it isn't a true grace period, but the
practical effect (no request-serving replica ever has zero valid connections)
is the same as long as your restart is actually rolling, not a stop-then-start.

## Redis (`REDIS_URL`)

[Redis production profile](deployment.md#redis-production-profile) already
recommends managed Redis with ACL user/password rather than the bundled
compose Redis's plain, unauthenticated default. If you're on ACL (`rediss://`
plus a named user, not the `default` user with `requirepass`), Redis natively
supports **multiple simultaneously valid passwords per user** — this is the
one secret class in this guide with a real, vendor-documented, zero-downtime
primitive, not a rolling-restart workaround:

1. `ACL SETUSER <user> >newpassword` — **adds** a new valid password; the
   existing one keeps working
   ([Redis ACL SETUSER](https://redis.io/docs/latest/commands/acl-setuser/)).
2. Update `REDIS_URL`/`COMPOSE_REDIS_URL` and roll `api`/`worker` (BullMQ
   connections included — same client, same connection string).
3. Once every replica is confirmed on the new password,
   `ACL SETUSER <user> <oldpassword` to invalidate the old one specifically
   (leaving any other passwords on the account untouched).

If you're still on the bundled compose Redis's single `requirepass`-style
password (or haven't set one at all — the default `local-infra` profile
doesn't): **verified against a real Redis 7 container**, `CONFIG SET
requirepass newpass` behaves exactly like Postgres above — a connection
already authenticated with the old password keeps working (`GET`/`PING`
both still succeed after the change), and only a _new_ connection attempt is
checked against the current password. So this isn't the brief-outage event a
single-password credential might suggest — the actual risk is different and
worth naming precisely: `requirepass` has exactly one value and no grace
period, so any connection that **reconnects** after you run `CONFIG SET` —
and `ioredis`/BullMQ reconnect on their own after any network blip, a Redis
restart, or a replica restart, with no warning — re-authenticates using
whatever `REDIS_URL` that specific process still has loaded in memory. If
that's the old password, the reconnect fails and stays failed until that
process is redeployed with the new `REDIS_URL`. Roll `api`/`worker` promptly
after `CONFIG SET requirepass` to close this window — not because existing
connections are at risk (they aren't), but because you don't control when a
reconnect gets triggered. BullMQ's AOF persistence (`docker-compose.yml`'s
`--appendonly yes`) means no queued job data is lost if a worker does hit
this window, but in-flight processing on that worker stalls until it
reconnects successfully. ACL removes this window entirely rather than just
narrowing it — that's the concrete reason the production guidance points
there, not just finer-grained permissions.

## OAuth provider secrets (`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`)

Google's own OAuth client console supports up to **two active client secrets
at once** specifically for this: add a new one, migrate, then disable/delete
the old one, with no window where the client is unauthenticatable
([Manage OAuth Clients — Google Cloud
Platform Console Help](https://support.google.com/cloud/answer/15549257)).
Rotation:

1. Add a new secret in Google Cloud Console → your OAuth client's
   credentials page (you can hold at most two; delete one first if you're
   already at the limit).
2. Update `GOOGLE_CLIENT_SECRET` and redeploy.
3. Verify a real "Sign in with Google" flow succeeds end-to-end.
4. Disable/delete the old secret in the console.

**This is a Google-specific feature, not a general OAuth guarantee** — check
whether your other configured providers (GitHub, Apple) offer an equivalent
before assuming the same zero-downtime shape; if not, a provider-side secret
change is a hard cutover the moment you save it there, so update
`{PROVIDER}_CLIENT_SECRET` and redeploy immediately after, and expect OAuth
sign-in specifically (not the rest of the app) to be briefly unavailable for
that provider in between.

**Apple (`APPLE_PRIVATE_KEY` / `APPLE_KEY_ID`) is structurally different from
the other two** — it isn't a string Apple hands you and checks as-is; it's a
private key you hold, and this app signs its own short-lived client-secret
JWT with it on every OAuth exchange. Apple's developer console reportedly
supports up to two active private keys per App
ID for exactly this rotation purpose, mirroring Google's/AWS's shape — verify
the current limit in your own account before relying on the number. Rotation:
generate a new key in the Apple Developer console (it's downloadable only
once — save it immediately), set both `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`
together (they're a pair; changing one without the other breaks signing),
redeploy, verify a real "Sign in with Apple" flow, then revoke the old key in
the console.

## Third-party API keys (email, storage, AI providers)

Covers `RESEND_API_KEY`, `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`,
and every AI provider key in `ai.env.ts` — `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `YANDEX_API_KEY`, and
`AI_OPENAI_COMPATIBLE_API_KEY`. All of them are the same shape: an opaque
string a provider's console issues and can revoke independently of any other
key on the same account.

These are all **API-key-issuance** secrets, not a single mutable value: every
provider's console lets you hold multiple independently-revocable keys, and
creating a new one never invalidates an existing one. That shape makes the
same pattern safe everywhere, with the one open question being how many keys
a given provider lets you hold at once — check the specific console before
relying on a number:

1. Create a new key in the provider's console (Resend, Anthropic, OpenAI, or
   your S3-compatible storage provider's IAM equivalent).
2. Update the corresponding env var and redeploy.
3. **Verify with a real call**, not just "no startup error" — a startup-time
   client construction succeeding proves nothing about whether the key is
   valid. Send a real test email, make a real (cheap) completion request, or
   `HEAD` the storage health-check key (`STORAGE_HEALTH_PROBE_KEY`, if
   `STORAGE_HEALTH_ENABLED=true`).
4. Revoke the old key in the provider's console.

**AWS specifically** documents this as the intended purpose of its two-key
limit per IAM user — create the second key, cut over, confirm, then delete the
first, with AWS's own guidance to keep the window measured in minutes/hours,
not months, since a second active key is a second long-lived credential that
can leak
([How to Rotate Access Keys for IAM Users — AWS Security
Blog](https://aws.amazon.com/blogs/security/how-to-rotate-access-keys-for-iam-users/)).
A non-AWS S3-compatible provider (`STORAGE_ENDPOINT` set) may cap you at a
different number of simultaneous keys, or fewer rotation conveniences — check
its own console.

## Two-sided secrets (webhooks, metrics scraping)

Every secret above is rotated unilaterally — you change it and a provider's
console (or nothing) is the only other party involved. `WEBHOOK_<PROVIDER>_SECRET`
(the per-provider values `WEBHOOK_SECRETS` aggregates, see
[Webhook verification](webhooks.md)) and `METRICS_AUTH_TOKEN` are different: an
external party holds the _same_ value and checks it against what you send (or
sends it for you to check), so changing your side alone breaks verification
until the other side changes too. Neither has a built-in grace period on
AMCore's side — each is a single value compared exactly, not an
issuance-style credential.

- **`WEBHOOK_<PROVIDER>_SECRET`** — for `telegram`, this is already documented
  end to end: [Telegram webhook
  registration](deployment.md#telegram-webhook-registration-one-shot-optional)
  says to set the new `WEBHOOK_TELEGRAM_SECRET`, redeploy, then re-run the
  one-shot `telegram-setup.js` so Telegram's `setWebhook` call is told the new
  secret too — until that re-run happens, Telegram keeps sending the _old_
  secret and every inbound webhook fails verification. For `stripe` or a
  `generic` integration, the equivalent is whatever that provider's dashboard
  calls "roll" or "regenerate" the webhook signing secret — update
  `WEBHOOK_<PROVIDER>_SECRET` and redeploy in the same motion as the
  provider-side change, since there is no window here where either an old or
  a new value alone verifies both directions.
- **`TELEGRAM_BOT_TOKEN`** — issued and revoked via `@BotFather`
  (`/revoke`), single value, no grace period. Update `TELEGRAM_BOT_TOKEN` and
  redeploy; re-run `telegram-setup.js` afterward too (it's a one-shot,
  idempotent to re-run) to confirm the webhook registration is still live
  against the new token, the same way a `WEBHOOK_TELEGRAM_SECRET` rotation
  requires.
- **`METRICS_AUTH_TOKEN`** — checked as an exact-match bearer token
  (`metrics-auth.guard.ts`, constant-time comparison, no second accepted
  value). Whatever scrapes `/metrics` (a Prometheus `scrape_config`'s
  `authorization`/`bearer_token`, or an equivalent) has this value configured
  independently of this app. Update both at the same time — changing only
  AMCore's side means every scrape fails with 401 until the scraper's config
  is updated too; changing only the scraper's side means the reverse.

## See also

- [Database role separation](database-role-separation.md) — the
  migrator/runtime split this guide's DB rotation section builds on.
- [Production deploy profile](production-deploy-profile.md) — where each
  secret is placed (environment-scoped vs. repo-scoped) before you ever need
  to rotate it.
- [Deployment & migrations](deployment.md#zerolow-downtime-rollout--stated-honestly) —
  the rolling-restart pattern this guide's DB section reuses, and the
  blue-green / simultaneous-restart alternatives the JWT section requires
  instead (rolling is specifically wrong there).
- [Deployment & migrations](deployment.md#redis-production-profile) — why
  production Redis should already be on ACL before you ever need to rotate
  its credential.
- [Webhook verification](webhooks.md) — the provider-keyed
  `WEBHOOK_<PROVIDER>_SECRET` shape this guide's two-sided secrets section
  points back to.
