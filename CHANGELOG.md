# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  - Dual-token format: `amk_{shortToken}_{longToken}`
  - `shortToken` stored in plaintext for O(1) DB lookup; `longToken` SHA-256 hashed
  - Scopes: `action:subject` format, effective = user permissions ∩ key scopes
  - Lazy `lastUsedAt` update via Redis gate (avoids hot row contention)
  - `POST/GET/DELETE /api-keys` — user manages own keys
  - `ApiKeyGuard` — parses `Authorization: Bearer amk_...`, verifies, populates request.user
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

## [0.1.0] - 2026-02-05

### Added

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

## [0.0.1] - 2026-01-27

### Added

- Initial repository setup
- Basic project structure
- README with project overview
- MIT License

---

[unreleased]: https://github.com/alex-morozov84/AMCore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alex-morozov84/AMCore/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/alex-morozov84/AMCore/releases/tag/v0.0.1
