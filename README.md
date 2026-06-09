# AMCore

> Modular personal productivity platform — fitness, finance, subscriptions.
> Built on a production-oriented NestJS API starter.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alex-morozov84/AMCore/badge)](https://scorecard.dev/viewer/?uri=github.com/alex-morozov84/AMCore)

## Overview

AMCore is a modular web application for personal productivity. The backend is designed as an exemplary open-source NestJS starter: strong application/security foundations, broad tests, and an active production-readiness track for deployment and operations.

### Application Modules

| Module            | Status     | Description                                         |
| ----------------- | ---------- | --------------------------------------------------- |
| **Fitness**       | 🚧 Next    | Workout tracking, exercise library, progress charts |
| **Finance**       | 📋 Planned | Wallet management, transaction tracking             |
| **Subscriptions** | 📋 Planned | Subscription monitoring, reminders                  |

## Tech Stack

| Layer            | Technology                                                          |
| ---------------- | ------------------------------------------------------------------- |
| **Backend**      | NestJS 11, PostgreSQL 16, Prisma 7, Redis, BullMQ                   |
| **Auth**         | JWT + Refresh Tokens, OAuth 2.0 / OIDC, API Keys                    |
| **Email**        | Resend, React Email 5, FormatJS i18n                                |
| **Storage**      | S3-compatible storage, local dev driver, memory test driver         |
| **Frontend**     | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui                     |
| **Architecture** | Feature-Sliced Design (FSD)                                         |
| **Monorepo**     | pnpm workspaces + Turborepo                                         |
| **Testing**      | Jest 30 (backend), Vitest 4 (email templates), Testcontainers (E2E) |

## Project Structure

```
amcore/
├── apps/
│   ├── api/        # NestJS backend — see apps/api/README.md
│   └── web/        # Next.js frontend (FSD)
├── packages/
│   ├── shared/     # Zod schemas, types, constants (used by api + web)
│   ├── eslint-config/
│   └── typescript-config/
├── docs/
│   ├── auth/       # Authentication & authorization documentation
│   ├── media/      # Image derivative/media processing documentation
│   └── storage/    # File storage documentation
└── .github/        # CI, Dependabot, issue/PR templates
```

## API Starter — What's Built

The backend is a fully-featured NestJS starter. The application/security baseline below is implemented and tested; operations/deployment hardening is tracked separately before the project restores an unqualified "fully production-ready" claim.

### Foundation

- Monorepo setup (pnpm + Turborepo), multi-schema PostgreSQL, Redis
- Environment validation (Zod, fails fast on startup)
- 3-layer exception filters (domain → Prisma → HTTP → catch-all)
- Structured logging with Pino: correlation ID, GDPR IP anonymization, sensitive data redaction
- Graceful shutdown (SIGTERM/SIGINT, log flush)
- Global rate limiting (10 req/s + 100 req/min via `@nestjs/throttler`), Redis-backed so limits are shared across API replicas; degrades to local in-memory limits if Redis is unavailable (ADR-039)
- Helmet, CORS, cookie parser
- Swagger/OpenAPI at `/docs` (dev only)
- CI/CD: lint, typecheck, test, build, boot-smoke, security scans, Dependabot

### Authentication

- Registration + login (Argon2id hashing)
- JWT access tokens (15 min) + opaque refresh tokens (7 days, SHA-256 hashed in DB)
- Refresh token rotation — old token destroyed on every use
- `httpOnly` + `secure` + `sameSite=strict` cookie for refresh token
- Session management: list, revoke one, revoke all, revoke others
- Password reset flow: single-use token, 15 min expiry, invalidates all sessions
- Email verification flow: single-use token, 48 h expiry
- Account enumeration prevention on forgot-password and resend-verification
- Login brute-force protection: per-IP (100/24 h) + per-email+IP (5/1 h → 15-min block)
- Redis-based rate limiting for sensitive operations (3/hour per email)

### OAuth 2.0 / OIDC

- **Google** — OIDC via discovery, PKCE (S256)
- **GitHub** — OAuth 2.0, verified primary email via `/user/emails`
- **Apple** — Sign In with Apple, dynamic JWT client secret (P8 key)
- **Telegram** — OIDC, link-only (no email), phone from ID token
- Account linking: authenticated users can connect additional providers
- State + PKCE stored in Redis (TTL 5 min, one-time use, CSRF protection)
- Provider factory pattern — providers disabled automatically if env vars missing

### RBAC (Role-Based Access Control)

- System roles: `USER` / `SUPER_ADMIN`
- Organization-scoped permissions via CASL + DB-backed roles
- `PermissionsCacheService` — Redis cache with `aclVersion` invalidation
- `AbilityFactory` — builds CASL abilities with condition interpolation (`${user.id}`)
- Decorators: `@Auth()`, `@CheckPolicies()`, `@SystemRoles()`, `@CurrentUser()`
- Organizations module: create, invite members, assign roles, switch context
- Admin module: user/org management, promote to SUPER_ADMIN

### API Keys

- Long-lived scoped tokens for server-to-server access
- Dual-token format: `amk_{shortToken}_{longToken}` (shortToken plain for O(1) lookup, longToken SHA-256 hashed)
- Scopes: `action:subject` format, intersected with user's org permissions
- Lazy `lastUsedAt` update via Redis gate (no hot row contention)
- Nightly cleanup of expired keys

### Infrastructure

- **Email** — Resend (prod) / Mock (dev), React Email templates, FormatJS i18n (RU/EN), direct send for secret links, BullMQ for non-secret notifications
- **Queue** — BullMQ, multiple queues, Bull Board at `/admin/queues` (SUPER_ADMIN only)
- **Cache** — Cache-aside with distributed locking (stampede protection), tag-based invalidation
- **Storage** — S3-compatible provider abstraction, local filesystem dev driver, in-memory test driver, magic-byte upload validation, signed/public URLs, opt-in health check, avatar upload/delete example
- **Health Checks** — `/health`, `/health/startup`, `/health/ready`, `/health/live` (Kubernetes-ready)
- **Scheduled Jobs** — Nightly cleanup at 02:00 UTC (expired sessions, tokens, API keys, invites) with multi-instance locking

### Tests

- Backend unit tests: Jest
- E2E suites: Jest + Testcontainers
- Email templates: Vitest integration tests (real rendering, RU/EN, plaintext)

### Documentation

- [`docs/auth/`](docs/auth/README.md) — Complete auth guide (concepts, flows, OAuth, RBAC, API reference)
- [`docs/storage/`](docs/storage/README.md) — Storage guide (providers, configuration, uploads, API reference)
- [`docs/media/`](docs/media/README.md) — Media processing guide (image derivatives, configuration, security)
- [`docs/authorization.md`](docs/authorization.md) — Authorization guide
- [`docs/operations/deployment.md`](docs/operations/deployment.md) — Deployment & migration runbook
- [`docs/operations/webhooks.md`](docs/operations/webhooks.md) — Signed inbound webhook guide
- [`docs/operations/idempotency.md`](docs/operations/idempotency.md) — HTTP idempotency contract and operations guide
- [`docs/operations/audit-log.md`](docs/operations/audit-log.md) — Persistent audit log semantics and append-only model
- [`docs/operations/observability.md`](docs/operations/observability.md) — Metrics and tracing guide
- [`docs/operations/ci-security.md`](docs/operations/ci-security.md) — CI security automation and manual repo prerequisites
- [`apps/api/README.md`](apps/api/README.md) — Backend architecture

## Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm 11+, Docker (Compose v2.20.2+)

git clone https://github.com/alex-morozov84/AMCore.git
cd AMCore
cp .env.example .env          # COMPOSE_PROFILES=local-infra is the default
```

**Option A — full stack in Docker** (bundled Postgres + Redis, schema migrated for you):

```bash
docker compose up             # one-shot `migrate` runs, then API + web start
# API: http://localhost:5002 · Swagger: http://localhost:5002/docs · Web: http://localhost:3000
```

**Option B — run the app on the host** (hot reload):

```bash
pnpm install
docker compose up -d postgres redis   # or point DATABASE_URL/REDIS_URL at your own
pnpm --filter api db:migrate          # prisma migrate dev (LOCAL development only)
pnpm dev
```

> Production uses `prisma migrate deploy` as a one-shot step before rollout — never
> `db:migrate` (which is `migrate dev`). To run the Docker stack against a
> managed/VPS DB or real S3, set `COMPOSE_PROFILES=` empty plus
> `COMPOSE_DATABASE_URL` / `COMPOSE_REDIS_URL` (and the S3 vars) in `.env`. See
> [`docs/operations/deployment.md`](docs/operations/deployment.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
