# AMCore

> Modular personal productivity platform — fitness, finance, subscriptions.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-morozov84/AMCore/actions/workflows/ci.yml)

## Overview

AMCore is a modular web application for personal productivity, built with modern technologies and clean architecture. Currently in active development.

### Modules

| Module            | Status     | Description                                         |
| ----------------- | ---------- | --------------------------------------------------- |
| **Fitness**       | 🚧 Phase 1 | Workout tracking, exercise library, progress charts |
| **Finance**       | 📋 Planned | Wallet management, transaction tracking             |
| **Subscriptions** | 📋 Planned | Subscription monitoring, reminders                  |

## Tech Stack

| Layer            | Technology                                                 |
| ---------------- | ---------------------------------------------------------- |
| **Backend**      | NestJS 10, PostgreSQL 16, Prisma 7, Redis, BullMQ          |
| **Email**        | Resend, React Email 5, FormatJS (i18n)                     |
| **Frontend**     | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui            |
| **Architecture** | Feature-Sliced Design (FSD)                                |
| **Monorepo**     | pnpm, Turborepo                                            |
| **Testing**      | Jest 30 (backend), Vitest 4 (frontend + email integration) |

## Project Structure

```
amcore/
├── apps/
│   ├── api/          # NestJS backend → See apps/api/README.md for architecture details
│   └── web/          # Next.js frontend (FSD: app, views, features, entities, shared)
├── packages/
│   ├── shared/       # Zod schemas, types, constants (used by api + web)
│   ├── eslint-config/# Shared ESLint configs
│   └── typescript-config/
└── .github/          # CI, Dependabot, issue/PR templates
```

**Documentation:**

- [API Architecture](apps/api/README.md) — Backend design, error handling, logging
- [Changelog](CHANGELOG.md) — Version history and release notes
- [Contributing](CONTRIBUTING.md) — Development workflow and guidelines

## Development Progress

### Phase 0: Foundation

| Task                                                | Status |
| --------------------------------------------------- | ------ |
| Repository & GitHub setup                           | ✅     |
| Monorepo structure (pnpm + Turborepo)               | ✅     |
| Tooling (ESLint, Prettier, Husky, commitlint)       | ✅     |
| Backend bootstrap (NestJS, Prisma, Redis)           | ✅     |
| Error handling & logging (Pino, correlation ID)     | ✅     |
| CI/CD pipeline (lint, typecheck, test, build)       | ✅     |
| Frontend bootstrap (Next.js 16, Tailwind, FSD)      | ✅     |
| Shared packages                                     | ✅     |
| Docker & deployment                                 | ✅     |
| **Authentication** (JWT + refresh tokens)           | ✅     |
| **Password Reset & Email Verification** (full flow) | ✅     |
| **Redis Caching** (production-ready patterns)       | ✅     |
| **Queue Infrastructure** (BullMQ)                   | ✅     |
| **Email Service** (Resend + React Email + i18n)     | ✅     |
| E2E testing infrastructure (TestContainers)         | ✅     |

**Highlights:**

- **Authentication System:** JWT + refresh tokens, session management, cookie-based auth
  - Password reset flow (forgot-password → reset-password)
  - Email verification flow (verify-email → resend-verification)
  - Rate limiting (3 req/hour per email via Redis)
  - Account enumeration prevention, single-use tokens (SHA-256 hashed)
  - All sessions invalidated on password reset
  - Machine-readable error codes (`AuthErrorCode` enum in `packages/shared`)
- **Redis Caching:** Production-ready user caching (50-100x faster auth)
  - Cache-aside pattern with distributed locking (stampede protection)
  - Tag-based invalidation (Redis Sets, not KEYS \*)
  - Hybrid TTL (10 min) + explicit invalidation
  - Comprehensive metrics tracking (hit/miss rate)
- **Queue Infrastructure:** BullMQ for background jobs
  - Default and Email queues with retry logic
  - Bull Board dashboard at `/admin/queues`
  - Exponential backoff and automatic cleanup
- **Email Service:** Production-ready with multilingual support
  - Resend (prod) / Mock (dev) provider pattern
  - React Email templates (TypeScript + Tailwind)
  - FormatJS i18n (RU/EN) - official React Email approach
  - Templates: welcome, password-reset, email-verification, password-changed
  - Async delivery via BullMQ (3 retries, exponential backoff)
- **Production-ready error handling** with hierarchical exception filters
- **Field-level validation errors** (Zod) with structured error responses
- **Structured logging** with correlation ID tracking (GDPR-compliant)
- **Business event logging** in services (AuthService, SessionService)
- **Graceful shutdown** with native NestJS lifecycle hooks
- **Enhanced Prisma error mapping** (8 error codes)
- **Comprehensive testing:**
  - 231 unit/integration tests (22 test suites)
  - 39 E2E tests with TestContainers (real PostgreSQL + Redis)
  - Two-framework approach: Jest for logic, Vitest for React Email rendering

### Coming Next

- Phase 1: Fitness Module MVP
- Phase 2: Finance Module
- Phase 3: Subscriptions Module

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

# Clone and install
git clone https://github.com/alex-morozov84/AMCore.git
cd AMCore
pnpm install

# Start infrastructure (PostgreSQL, Redis)
docker compose up -d

# Copy environment variables
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# Run database migrations
pnpm --filter api db:migrate

# Start development servers
pnpm dev
```

Before contributing, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
