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

| Layer            | Technology                                        |
| ---------------- | ------------------------------------------------- |
| **Backend**      | NestJS 10, PostgreSQL 16, Prisma 7, Redis, BullMQ |
| **Frontend**     | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui   |
| **Architecture** | Feature-Sliced Design (FSD)                       |
| **Monorepo**     | pnpm, Turborepo                                   |

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

| Task                                            | Status |
| ----------------------------------------------- | ------ |
| Repository & GitHub setup                       | ✅     |
| Monorepo structure (pnpm + Turborepo)           | ✅     |
| Tooling (ESLint, Prettier, Husky, commitlint)   | ✅     |
| Backend bootstrap (NestJS, Prisma, Redis)       | ✅     |
| Error handling & logging (Pino, correlation ID) | ✅     |
| CI/CD pipeline (lint, typecheck, test, build)   | ✅     |
| Frontend bootstrap (Next.js 16, Tailwind, FSD)  | ✅     |
| Shared packages                                 | ✅     |
| Docker & deployment                             | ✅     |

**Highlights:**

- Production-ready error handling with hierarchical exception filters
- Field-level validation errors (Zod) with structured error responses
- Structured logging with correlation ID tracking (GDPR-compliant)
- Business event logging in services (AuthService, SessionService)
- Graceful shutdown with native NestJS lifecycle hooks
- Enhanced Prisma error mapping (8 error codes)
- Health checks with @SkipThrottle decorator
- 53 unit tests with comprehensive coverage

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
