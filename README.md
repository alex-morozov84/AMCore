# AMCore

> Modular personal productivity platform — fitness, finance, subscriptions.
> Built on a production-ready NestJS API starter.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)

## Overview

AMCore is a modular web application for personal productivity. The backend is designed as an exemplary open-source NestJS starter — production-ready, well-tested, and easy to fork.

### Application Modules

| Module            | Status     | Description                                         |
| ----------------- | ---------- | --------------------------------------------------- |
| **Fitness**       | 🚧 Next    | Workout tracking, exercise library, progress charts |
| **Finance**       | 📋 Planned | Wallet management, transaction tracking             |
| **Subscriptions** | 📋 Planned | Subscription monitoring, reminders                  |

## Tech Stack

| Layer            | Technology                                                          |
| ---------------- | ------------------------------------------------------------------- |
| **Backend**      | NestJS 10, PostgreSQL 16, Prisma 6, Redis, BullMQ                   |
| **Auth**         | JWT + Refresh Tokens, OAuth 2.0 / OIDC, API Keys                    |
| **Email**        | Resend, React Email 5, FormatJS i18n                                |
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
│   └── auth/       # Authentication & authorization documentation
└── .github/        # CI, Dependabot, issue/PR templates
```

## API Starter — What's Built

The backend is a fully-featured NestJS starter. Everything below is production-ready with tests.

### Foundation

- Monorepo setup (pnpm + Turborepo), multi-schema PostgreSQL, Redis
- Environment validation (Zod, fails fast on startup)
- 3-layer exception filters (domain → Prisma → HTTP → catch-all)
- Structured logging with Pino: correlation ID, GDPR IP anonymization, sensitive data redaction
- Graceful shutdown (SIGTERM/SIGINT, log flush)
- Global rate limiting (10 req/s + 100 req/min via `@nestjs/throttler`)
- Helmet, CORS, cookie parser
- Swagger/OpenAPI at `/docs` (dev only)
- CI/CD: lint, typecheck, test, build (4 parallel jobs), Dependabot

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

- **Email** — Resend (prod) / Mock (dev), React Email templates, FormatJS i18n (RU/EN), BullMQ delivery
- **Queue** — BullMQ, multiple queues, Bull Board at `/admin/queues` (SUPER_ADMIN only)
- **Cache** — Cache-aside with distributed locking (stampede protection), tag-based invalidation
- **Health Checks** — `/health`, `/health/startup`, `/health/ready`, `/health/live` (Kubernetes-ready)
- **Scheduled Jobs** — Nightly cleanup at 02:00 UTC (expired sessions, tokens, API keys)

### Tests

- **462 total:** 382 unit (40 suites) + 80 E2E (5 suites via Testcontainers)
- E2E suites: auth, organizations, admin, api-keys, oauth
- Email templates: Vitest integration tests (real rendering, RU/EN)

### Documentation

- [`docs/auth/`](docs/auth/README.md) — Complete auth guide (concepts, flows, OAuth, RBAC, API reference)
- [`docs/authorization.md`](docs/authorization.md) — Authorization guide
- [`apps/api/README.md`](apps/api/README.md) — Backend architecture

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

git clone https://github.com/alex-morozov84/AMCore.git
cd AMCore
pnpm install

# Start PostgreSQL + Redis
docker compose up -d

# Configure environment
cp .env.example .env

# Run migrations
pnpm --filter api db:migrate

# Start development
pnpm dev
```

API runs at `http://localhost:3001`, Swagger UI at `http://localhost:3001/docs`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
