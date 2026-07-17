# AMCore

> Production-oriented NestJS application starter for secure, modular products.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alex-morozov84/AMCore/badge)](https://scorecard.dev/viewer/?uri=github.com/alex-morozov84/AMCore)

## Overview

AMCore is a production-oriented application starter for building secure, modular
SaaS products, internal tools, and AI-enabled systems. The current reusable
surface is backend-first: a NestJS API foundation with strong application and
security primitives, broad tests, and a completed production-readiness baseline.
Deployment targets and CD environments remain adopter-specific.

The repository also contains a Next.js frontend workspace. It is intentionally
kept as a starter shell while the backend surface is completed, then will be
brought up to the same quality bar instead of being removed.

### Backend Starter Capabilities

| Capability        | Status          | Description                                                                                 |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------- |
| **Auth & RBAC**   | ✅ Shipped      | Email auth, OAuth/OIDC, sessions, organizations, CASL permissions, admin flows              |
| **API Keys**      | ✅ Shipped      | Long-lived scoped server-to-server tokens with hashed secrets and org permission checks     |
| **Storage**       | ✅ Shipped      | S3-compatible, local, and memory drivers with private-by-default uploads and download seams |
| **Media**         | ✅ Foundational | Safe image derivatives via `sharp`/libvips; avatar upload/delete is the shipped consumer    |
| **Notifications** | ✅ Shipped      | In-app feed, preferences, durable email + Telegram dispatch, realtime SSE fan-out           |
| **AI Capability** | ✅ Foundational | Provider-agnostic assistants, runs, tools/approvals, takeover, multimodal inputs            |
| **Operations**    | ✅ Shipped      | Health, observability, audit log, idempotency, webhooks, CI/security automation             |

### Product Modules

Product-specific modules are intentionally left to downstream applications.
Forks can add their own bounded areas on top of the starter's reusable
capabilities without inheriting an unrelated sample domain.

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
│   ├── backend/        # Backend module boundaries and extension conventions
│   ├── auth/           # Authentication & authorization documentation
│   ├── ai/             # AI capability layer (assistants, runs, tools, artifacts, providers, security)
│   ├── email/          # Email extension contract (templates, queueing, secret-bearing sends)
│   ├── notifications/  # Notifications subsystem (in-app feed, durable email & Telegram dispatch, realtime SSE, preferences)
│   ├── media/          # Image derivative/media processing documentation
│   ├── operations/     # Deployment, observability, security, and production runbooks
│   └── storage/        # File storage documentation
└── .github/        # CI, Dependabot, issue/PR templates
```

## What's Built

The backend starter includes the core application, security, and operations
primitives needed for a product-grade API. Production deployment still requires
adopter-owned infrastructure, secrets, environments, and capacity choices.

| Area                  | Start here                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| All docs by intent    | [`docs/README.md`](docs/README.md) — the documentation map                                     |
| Backend architecture  | [`apps/api/README.md`](apps/api/README.md)                                                     |
| Add a backend module  | [`docs/backend/architecture-and-conventions.md`](docs/backend/architecture-and-conventions.md) |
| Auth, OAuth, sessions | [`docs/auth/`](docs/auth/README.md)                                                            |
| RBAC / authorization  | [`docs/auth/rbac.md`](docs/auth/rbac.md)                                                       |
| Email                 | [`docs/email/`](docs/email/README.md)                                                          |
| Notifications         | [`docs/notifications/`](docs/notifications/README.md)                                          |
| AI capability layer   | [`docs/ai/`](docs/ai/README.md)                                                                |
| Storage and media     | [`docs/storage/`](docs/storage/README.md), [`docs/media/`](docs/media/README.md)               |
| Production operations | [`docs/operations/`](docs/operations/README.md) — deployment, observability, CI security       |
| API surface           | Swagger/OpenAPI at `/docs` in development                                                      |

Tests use Jest for backend unit tests, Jest + Testcontainers for API E2E suites,
and Vitest for React Email template rendering.

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

> **Building a product from this starter?** First update
> [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) from `upstream-starter` to
> `downstream-product` and record the product identity, roadmap location, upstream-sync
> policy, and workflow mode: `strict`, `flexible`, or `custom`. Repository files
> _declare_ the technical policy; GitHub-side enforcement is separate external state.
> For `strict` mode, apply the supported settings with one command (`gh` + `jq` +
> repo admin): `bash scripts/setup-repo-security.sh`. `flexible` and `custom`
> forks may choose different repository protections, but should document their
> rules in `PROJECT_CONTEXT.md` or their contributor guide. Deployment environments
> and secrets are configured separately. See
> [`docs/operations/ci-security.md` → What a fork inherits](docs/operations/ci-security.md#what-a-fork-inherits-and-what-it-doesnt).

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
