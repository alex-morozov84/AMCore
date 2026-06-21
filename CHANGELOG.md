# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Telegram notification channel (notifications Arc D). A third external channel
  alongside in-app and email. A bearer user issues a one-time deep link
  (`POST /notifications/telegram/link`), opens the bot and presses **Start**; an inbound
  webhook (`POST /webhooks/telegram`, authenticated by a constant-time
  `X-Telegram-Bot-Api-Secret-Token` header — a new verifier family on the ADR-044
  primitive) binds the chat to the account in one transaction with durable `update_id`
  dedupe (effect-once), a one-time hashed token consumed only on a fully successful bind,
  and never silently moving a chat owned by another account. `GET /notifications/telegram/
connection` reports status; `DELETE …/connection` unlinks (cancelling pending
  deliveries). Outbound delivery is drained by the existing worker-only dispatcher through
  a direct Bot API client (plain text, no `parse_mode`); an unlinked user is an observable
  `SKIPPED telegram_not_linked` (never a retry storm), a blocked/chat-not-found destination
  fences the connection, and a `429 retry_after` is honored as a retry **floor** (clamped
  to 24h, never the 15-min cap). Opt-in via config; `apps/web` stays a stub (the deep link
  is returned as a string). Deploy registers the webhook once with
  `node dist/cli/telegram-setup.js`. See
  [`docs/notifications/README.md`](docs/notifications/README.md),
  [`docs/operations/webhooks.md`](docs/operations/webhooks.md), and
  [`docs/operations/deployment.md`](docs/operations/deployment.md).

- Realtime in-app notification stream (notifications Arc C). A bearer-authenticated
  Server-Sent Events endpoint `GET /notifications/stream` pushes a content-free hint
  (`created` / `read` / `archived` / `unread_changed`) whenever the recipient's feed
  changes, so a client refreshes without polling — Postgres stays the source of truth
  and every event means "refetch". Cross-replica fan-out runs over an environment- and
  version-namespaced Redis Pub/Sub channel with one dedicated subscriber per web
  replica and **no sticky sessions**; delivery is at-most-once and a dropped hint is
  recovered by the next reconnect refetch. The endpoint is a manual bounded writer (not
  `@Sse`): admission is enforced before any bytes (per-user cap → 429, global
  per-process cap → 503), the stream closes at access-token expiry (bounded by a server
  cap), a slow consumer is disconnected on write-buffer overflow, and the access token
  is sent via the `Authorization` header (never the URL). Tunable via
  `NOTIFICATIONS_REALTIME_*` env vars — deployments sharing one Redis must set a distinct
  `NOTIFICATIONS_REALTIME_NAMESPACE`. No JS client ships (`apps/web` stays a stub); the
  documented client contract and proxy/HTTP-2 guidance are in
  [`docs/notifications/README.md`](docs/notifications/README.md) and
  [`docs/operations/deployment.md`](docs/operations/deployment.md).
- Durable external notification delivery (notifications Arc B). A worker-only
  dispatcher drains `PENDING` deliveries with a Postgres `FOR UPDATE SKIP LOCKED`
  claim, leases each attempt, and owns the retry schedule and immutable attempt
  history — BullMQ is only a one-attempt wake hint, and a recovery `@Cron` (on
  every replica, not singleton-locked) drains a delivery whose wake was lost or
  that came from `notifyTx`. Finalize is a `(id, leaseToken)` compare-and-set, so
  a stale lease holder can never overwrite newer state; an expired lease is
  reaped (`ABANDONED` attempt → reschedule or fail). Ships the **email channel**:
  a worker-only adapter over `EmailService.send()` with a stable provider
  idempotency key (`notification-delivery:<id>`) that never enqueues the email
  queue, sent to a **verified** account-email destination only (an unverified
  address yields a `SKIPPED` delivery, never a retried `PENDING`). Adds a daily
  worker-only retention sweep (archived −30d, read −90d, unread −180d, finished
  attempts −30d) that never deletes a notification with an active delivery.
  First production definition: `account.password_changed` (security; in-app +
  email, both mandatory).
- Reusable notifications subsystem (in-app surface). Own `notifications`
  Postgres schema with a canonical per-user `Notification`, per-target
  `NotificationDelivery`, and immutable `NotificationDeliveryAttempt`;
  in-app delivery is inserted `DELIVERED` in the same database transaction as
  the canonical row, so the feed never depends on a worker. Bearer-authenticated
  HTTP surface for the recipient-scoped feed (cursor `(createdAt DESC, id DESC)`,
  no `total`), unread count, mark-read / mark-all-read / archive (idempotent),
  capabilities, per-`(category, channel)` preferences, and the master toggle
  (`PATCH /notifications/settings`). Internal `NotificationsService.notify()`
  and transaction-aware `notifyTx(tx, …)` are the only ways to create a
  notification — there is no public create endpoint. Required namespaced
  idempotency key with a stored payload fingerprint: a same-key retry with a
  matching fingerprint replays the existing row, a mismatching fingerprint
  fails stably. Definitions are code-owned and declare payload schema +
  default / mandatory channels + content classification + a localized
  `renderInApp`; titles and bodies are rendered server-side from the structured
  payload in the recipient's current `User.locale` at feed read time. (Email
  delivery shipped in Arc B, realtime SSE fan-out in Arc C, and the Telegram
  channel in Arc D — all above; Web Push and the triggered follow-ons remain
  future work.)
  Fork-facing guide: [`docs/notifications/README.md`](docs/notifications/README.md).
- Backend Architecture & Conventions guide
  (`docs/backend/architecture-and-conventions.md`): the end-to-end recipe for
  adding a module — boundaries, shared Zod contracts, process-role composition,
  the external-state fencing pattern, and the required OpenAPI/process-role tests.
- Explicit request-body size limit of 100 000 bytes (decimal) for JSON and
  urlencoded bodies, applied globally — including raw-body webhook routes — and
  shared by the production and e2e bootstraps so the limit is identical in both.
  The limit is measured against the decoded body (after any `Content-Encoding`
  inflation), not the wire size. An oversized body is rejected before route
  guards run (so a webhook signature is never evaluated for a too-large payload)
  and surfaces as `413 Payload Too Large` with a stable `PAYLOAD_TOO_LARGE` error
  code instead of a generic 500. Signature verification is unaffected — the
  verifier hashes `req.rawBody`, the decoded body buffer; multipart uploads keep
  their own Multer limit.
- Every public endpoint now documents its success response body and status code
  in the OpenAPI spec (`/docs`). Responses are declared with `@ZodResponse`, which
  keeps the runtime serialization, the TypeScript return type, and the generated
  schema in sync from a single source; a generated-spec test fails if a new
  handler ships without a typed success response.
- User locale is now resolved at registration and editable afterwards. `POST
/auth/register` accepts an optional `locale` (`ru`/`en`) and, when it is
  omitted, negotiates the best supported language from the `Accept-Language`
  header before falling back to the default. New OAuth users are seeded the same
  way from the language negotiated when the login flow started (an existing
  user's stored preference is never overwritten).
- `PATCH /auth/me` (Bearer only) to update the current user's `name`, `locale`,
  and `timezone`. Only supplied fields change; `timezone` is validated as an IANA
  zone and an explicit stored `locale` always wins over `Accept-Language`
  thereafter.

### Changed

- The `account.password_changed` security alert now also delivers to Telegram for a
  linked user (Arc D), as an **optional, non-mandatory** default channel — generic
  plain-text, disableable in preferences, and a no-op (`SKIPPED`) for an unlinked user.
  In-app and email remain mandatory and unchanged.
- Password reset now marks the account email **verified** in the same
  transaction as the password update: a successful reset proves control of the
  account mailbox (the single-use token was delivered there and returned), per
  OWASP Forgot Password / NIST 800-63B. The reset token is also consumed
  atomically (a guarded conditional update), so two concurrent resets cannot both
  succeed on one single-use token. The password-changed confirmation is now
  emitted through the durable notifications subsystem (`account.password_changed`)
  instead of a one-off queued email; the standalone `PASSWORD_CHANGED` email
  template/path was retired (`welcome` is now the only queued email template).
- API production build no longer compiles test artifacts into `dist` (and thus
  the runtime image): `.swcrc` now excludes `*.spec.ts`, `*-spec.ts`, `__tests__`,
  and `__mocks__` (SWC ignores the `tsconfig.build.json` excludes). Removed the
  redundant `@types/uuid` (uuid v13 ships its own types).

### Fixed

- Concurrent avatar uploads/deletes for the same user no longer corrupt storage.
  A monotonic per-user generation (`User.avatarGeneration`) fences every avatar
  mutation: the publish/delete is a conditional update that only lands while the
  stored generation is older, and a mutation only sweeps versions strictly older
  than its own. So a request that lost the race can neither overwrite the newer
  `avatarUrl` nor delete the live version — previously one upload's cleanup could
  delete the version another upload just published, leaving `avatarUrl` pointing at
  deleted storage. A per-user Redis lock serializes the common case; under
  contention, a lost race, or a Redis outage the request fails closed with a
  retriable `503` (`AVATAR_LOCKED`).
- Sign in with Apple now works end-to-end on the web. Apple uses
  `response_mode=form_post` and POSTs the callback, but only a GET callback
  existed (the POST 404'd) and the `SameSite=Lax` binding cookie was never sent
  on Apple's cross-site POST. Added a `POST /auth/oauth/:provider/callback`
  sharing one handler with the GET path, a dedicated `SameSite=None; Secure`
  binding cookie scoped to the Apple callback path, and first-login display-name
  capture from Apple's `user` field. Other providers are unchanged.
- Corrected auth token-verification and password-reset entropy documentation,
  avatar storage/media/API architecture documentation, and stale version,
  SHA-256, and media module comments.
- Reconciled `docs/auth/email-auth.md` with runtime: registration returns
  `201 Created` (not `200`), `GET /auth/me` wraps the user in a `user` envelope,
  invalid reset/verify tokens return `401` (not `400`), and the response examples
  no longer show a non-returned `systemRole` field.

### Security

- Closed two code-scanning findings on the security tooling rather than the app.
  `yaml` is pinned to 2.8.3 on the 2.x line (CVE-2026-33532 stack-overflow DoS;
  `lint-staged` still resolved 2.8.2, dev-only). The production Docker **runner**
  stage no longer inherits Corepack/pnpm (`FROM node:22-slim` instead of `base`):
  the container only runs `node dist/main.js`, and the one-shot migration runs the
  Prisma binary from the self-contained bundle, so pnpm is never used at runtime.
  This removes Corepack's bundled `undici` (CVE-2026-12151) from the shipped image
  and trims its attack surface. Verified on the built image: no Corepack pnpm
  cache, no runnable pnpm, and no `undici` package present.
- Resolved the 2026-06-20 transitive-advisory batch via `pnpm-workspace.yaml`
  overrides, all within the parents' declared ranges: `multer` 2.2.0
  (`@nestjs/platform-express`), `form-data` 4.0.6 (`axios`), `hono` 4.12.25,
  `vite` 7.3.5, and the dev/build-only `undici` 7.28.0 (`testcontainers`),
  `piscina` 4.9.3 (`@swc/cli` / `@nestjs/cli`), `@babel/core` 7.29.6. `js-yaml`
  is pinned to 4.2.0 on the 4.x line only (GHSA-h67p-54hq-rp68); the dev-only 3.x
  consumer (`@istanbuljs/load-nyc-config`, coverage tooling) predates the 4.x API
  and parses only trusted project config.
- Bumped the `protobufjs` override to 7.6.3 and `tmp` to 0.2.7, closing three
  transitive advisories (two high, one medium). `protobufjs` stays on the 7.x
  line its parents require (`@nestjs/terminus` > `@grpc/grpc-js`, and the dev-only
  `testcontainers` > `dockerode`); `tmp` is dev-only via `testcontainers`.
- Resolved transitive dependency advisories (`protobufjs`, `tmp`, `fast-uri`,
  `rollup`, `lodash`, `brace-expansion`, `picomatch`) by materializing pnpm
  version overrides. The overrides were previously declared under
  `package.json` `pnpm.overrides`, which pnpm 11 silently ignores; they now live
  in `pnpm-workspace.yaml` and are reflected in the lockfile. `brace-expansion`
  is pinned per major line (v1/v5) so the patched v5 is not forced onto v1
  consumers.
- Upgraded `next` to 16.2.9 and `next-intl` to 4.13.0, closing the Next.js
  advisories (middleware/proxy bypass, SSRF, XSS, cache poisoning, DoS) and the
  `next-intl` open-redirect / prototype-pollution advisories.
- Bumped `uuid` to 13.0.2 and the `protobufjs` override to 7.5.8 (newer advisory
  than the previous 7.5.6 pin). Forced the dev-only `uuid@10` (testcontainers)
  to the patched 11.1.1.
- Patched remaining transitive advisories via overrides: `@grpc/grpc-js` 1.14.4,
  `hono` 4.12.21, `@hono/node-server` 1.19.13, `postcss` 8.5.14, `ws` 8.21.0,
  `ajv` 8.20.0, `qs` 6.15.2, `esbuild` 0.28.1; and upgraded `turbo` to 2.9.18.
  Overrides are scoped to the vulnerable major so safe coexisting majors are
  untouched.

## [0.1.0] - 2026-06-12

First tagged release and baseline for SemVer versioning. Captures the Track A
production-readiness work and the platform foundation built so far.

### Added

- **Storage Service:**
  - Cloud-agnostic `StorageService` facade with `StorageProvider` contract
  - Drivers: S3-compatible production provider, local filesystem dev provider, in-memory test provider
  - S3 compatibility for AWS S3, Cloudflare R2, DigitalOcean Spaces, Yandex Object Storage, and Backblaze B2
  - AWS SDK checksum mode `WHEN_REQUIRED` for non-AWS compatibility
  - Public URL and signed URL support with capability checks
  - Private-by-default uploads; `UploadResult` deliberately carries no guaranteed URL
  - Object-key guard: traversal, leading slash, backslash, control chars, empty keys, and overlong keys rejected
  - `deleteMany()` S3 chunking with aggregate partial-failure exception
  - `FileValidationPipe` with magic-byte validation and presets for avatars, images, and documents
  - SVG rejected from image presets by default
  - Opt-in storage readiness check via `STORAGE_HEALTH_ENABLED`
  - App-mediated download primitive for authorized consumers
  - `POST /auth/me/avatar` and `DELETE /auth/me/avatar` public-read example consumer
  - `docs/storage/` user-facing storage guide
- **OAuth 2.0 / OIDC — Social Login & Account Linking:**
  - `openid-client` v6 (panva) — industry standard, zero transitive deps
  - **Google** provider — OIDC via discovery, PKCE (S256), ID token validation
  - **GitHub** provider — OAuth 2.0, verified primary email via `/user/emails`
  - **Apple** provider — Sign In with Apple, dynamic JWT client secret (P8 key + jose)
  - **Telegram** provider — OIDC, link-only (no email), phone number from ID token
  - Account linking: `GET /auth/oauth/:provider/link` for authenticated users
  - OAuth state + PKCE stored in Redis (TTL 5 min, one-time use, CSRF-protected)
  - Provider factory pattern: providers auto-disabled when env vars missing
  - `GET /auth/oauth/providers` — returns only configured providers
  - `OAUTH_ACCOUNT_ALREADY_LINKED` error code in shared package
  - 14 E2E tests: redirect flow, state validation, new/existing users, email matching, replay prevention
  - 23 unit tests across 5 provider files
- **Auth Documentation:**
  - `docs/auth/README.md` — overview and 30-second mental model
  - `docs/auth/concepts.md` — tokens, sessions, security model
  - `docs/auth/email-auth.md` — register, login, password reset, email verification
  - `docs/auth/sessions.md` — token rotation, session management
  - `docs/auth/oauth.md` — OAuth flows, all 4 providers, account linking
  - `docs/auth/rbac.md` — system roles, org permissions, CASL, caching
  - `docs/auth/api-keys.md` — scopes, create, revoke, security notes
  - `docs/auth/reference.md` — all endpoints, error codes, environment variables

### Added (previous unreleased)

- **RBAC (Role-Based Access Control):**
  - System roles: `USER` / `SUPER_ADMIN` stored in JWT
  - Organization-scoped permissions via CASL + DB-backed roles/permissions
  - `PermissionsCacheService` — Redis cache with `aclVersion`-based invalidation
  - `AbilityFactory` — builds CASL AppAbility with JSON condition interpolation
  - Single `AuthenticationGuard` — JWT → ApiKey → ability build in correct order
  - `@CheckPolicies()`, `@SystemRoles()`, `@Auth()` decorators
  - Organizations module: create, invite members, switch context, role management
  - Admin module: list users/orgs, promote to SUPER_ADMIN (`/admin/*`)
  - Bull Board dashboard protected with `@SystemRoles(SystemRole.SuperAdmin)`
  - Prisma seed: system roles + permissions (`pnpm db:seed`)
  - `docs/authorization.md` — user-facing authorization guide
- **Login Brute-Force Protection:**
  - `LoginRateLimiterService` — Redis-based, no external rate-limit packages
  - Per-IP: 100 failed attempts per 24 hours
  - Per-email+IP: 5 failed attempts per 1 hour → 15-minute block
  - Counters reset on successful login
- **API Key Authentication:**
  - Dual-token format: `amcore_live_{shortToken}_{longToken}`
  - `shortToken` stored in plaintext for O(1) DB lookup; `longToken` SHA-256 hashed
  - Scopes: `action:subject` format, effective = user permissions ∩ key scopes
  - Lazy `lastUsedAt` update via Redis gate (avoids hot row contention)
  - `POST/GET/DELETE /api-keys` — user manages own keys
  - `ApiKeyGuard` — parses `Authorization: Bearer amcore_live_...`, verifies, populates request.user
  - Expired API keys included in nightly `CleanupService` run
  - 15 unit tests, 7 E2E tests
- **Scheduled Tasks:**
  - `CleanupService` — nightly cron at 02:00 UTC
  - Deletes expired sessions, password reset tokens, email verification tokens, and API keys
  - `POST /admin/cleanup` — manual trigger for SUPER_ADMIN
  - Logs deleted counts per table
- **Queue Infrastructure (BullMQ):**
  - Multiple queues: `default` + `email`
  - Default job options: 3 attempts, exponential backoff, auto-cleanup
  - Bull Board dashboard at `/admin/queues`
  - `QueueService` with typed job dispatch
- **Email Service (Resend + React Email):**
  - Provider pattern: `ResendProvider` (prod) / `MockProvider` (dev/test)
  - 4 React Email templates: welcome, password-reset, email-verification, password-changed
  - FormatJS i18n (RU/EN) with ICU Message Format
  - Async dispatch via BullMQ (3 attempts, exponential backoff)
  - Two-framework testing: Jest for logic, Vitest for real template rendering
- **Redis Caching:**
  - `UserCacheService` — cache-aside, 10 min TTL, 50-100x faster auth
  - Distributed locking (stampede protection)
  - Tag-based invalidation (Redis Sets, not `KEYS *`)
  - Null caching (60 s TTL for not-found users)
- **Health Checks:**
  - `GET /health` — DB + Redis + disk + memory
  - `GET /health/startup` — DB + Redis (startup probe)
  - `GET /health/ready` — DB + Redis + disk + memory 1 GB (readiness probe)
  - `GET /health/live` — memory 1.5 GB only (liveness probe, no external deps)
  - Custom `PrismaHealthIndicator` and `RedisHealthIndicator`
- **E2E Testing Infrastructure:**
  - Testcontainers: real PostgreSQL 16 + Redis 7 per test suite
  - 5 suites: auth (42), organizations (10), admin (7), api-keys (7), oauth (14)

### Added (initial foundation)

- **Phase 0: Foundation**
  - Monorepo setup with pnpm workspaces + Turborepo
  - NestJS 10 backend with modular architecture
  - Next.js 16 frontend with App Router and React Compiler
  - PostgreSQL 16 with Prisma 6 ORM (multi-schema: core, fitness, finance, subscriptions)
  - Redis integration for caching and sessions
  - JWT authentication with refresh tokens (rotation, httpOnly cookie)
  - User registration and login endpoints
  - Session management (list, revoke, revoke all)
  - Password reset flow (forgot-password → reset-password)
  - Email verification flow (verify-email → resend-verification)
  - Rate limiting for auth operations (3/hour per email via Redis)
  - Account enumeration prevention
  - Environment variable validation with Zod (crashes fast on bad config)
  - 3-layer exception filters: `AllExceptionsFilter`, `PrismaClientExceptionFilter`, `HttpExceptionFilter`
  - Domain exceptions: `AppException`, `NotFoundException`, `ConflictException`, `BusinessRuleViolationException`
  - Structured logging with Pino: correlation ID, GDPR IP anonymization, sensitive data redaction
  - Graceful shutdown (SIGTERM/SIGINT, log flush before exit)
  - Global rate limiting (10 req/s + 100 req/min)
  - Helmet, CORS, cookie parser
  - Swagger/OpenAPI at `/docs`
  - Feature-Sliced Design (FSD) frontend architecture
  - Tailwind CSS 4 + shadcn/ui
  - Zustand for client state, TanStack Query for server state
  - Docker Compose for local development (multi-stage Dockerfile)
  - CI/CD pipeline (lint, typecheck, test, build — 4 parallel jobs)
  - Dependabot for automated dependency updates
  - ESLint + Prettier + Husky + lint-staged + commitlint

## 0.0.1 - 2026-01-27

### Added

- Initial repository setup
- Basic project structure
- README with project overview
- MIT License

---

[unreleased]: https://github.com/alex-morozov84/AMCore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alex-morozov84/AMCore/releases/tag/v0.1.0
