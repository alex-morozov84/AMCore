# AMCore

> Modular personal productivity platform — fitness, finance, subscriptions.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](LICENSE)
[![CI](https://github.com/aleksandr-morozov/amcore/actions/workflows/ci.yml/badge.svg)](https://github.com/aleksandr-morozov/amcore/actions/workflows/ci.yml)

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

## Development Progress

### Phase 0: Foundation

| Task                                           | Status |
| ---------------------------------------------- | ------ |
| Repository & GitHub setup                      | ✅     |
| Monorepo structure (pnpm + Turborepo)          | ✅     |
| Tooling (ESLint, Prettier, Husky, commitlint)  | ✅     |
| Backend bootstrap (NestJS, Prisma, Redis)      | ✅     |
| CI/CD pipeline (lint, typecheck, test, build)  | ✅     |
| Frontend bootstrap (Next.js 16, Tailwind, FSD) | ✅     |
| Shared packages                                | ✅     |
| Docker & deployment                            | ⏳     |

### Coming Next

- Phase 1: Fitness Module MVP
- Phase 2: Finance Module
- Phase 3: Subscriptions Module

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

# Clone and install
git clone https://github.com/aleksandr-morozov/amcore.git
cd amcore
pnpm install

# Start infrastructure (PostgreSQL, Redis)
docker compose up -d

# Copy environment variables
cp .env.example .env

# Run database migrations
pnpm --filter api prisma:migrate

# Start development servers
pnpm dev
```

## Author

**Alexander Morozov** — [alex-morozov.com](https://alex-morozov.com)

## License

[MIT](LICENSE)
