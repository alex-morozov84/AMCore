# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Changed

- API production build no longer compiles test artifacts into `dist` (and thus
  the runtime image): `.swcrc` now excludes `*.spec.ts`, `*-spec.ts`, `__tests__`,
  and `__mocks__` (SWC ignores the `tsconfig.build.json` excludes). Removed the
  redundant `@types/uuid` (uuid v13 ships its own types).

### Security

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
