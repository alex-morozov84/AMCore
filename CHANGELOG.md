# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Production-ready error handling system with hierarchical exception filters
- Correlation ID tracking across all requests and logs (via nestjs-cls)
- GDPR-compliant logging with IP anonymization (IPv4/IPv6)
- User-Agent logging for debugging and analytics
- Comprehensive exception test coverage (45 unit tests)
- Structured JSON logging with Pino (nestjs-pino)
- Automatic context propagation (correlationId, userId, ip, userAgent)
- Prisma error mapping to HTTP status codes (P2002→409, P2025→404, etc.)
- Domain exception classes (NotFoundException, BusinessRuleException, ConflictException)
- Sensitive data redaction in logs (passwords, tokens, API keys)

### Changed

- Enhanced LoggerModule configuration with environment-specific log levels
- Updated exception filters to include correlation ID in all responses
- Improved error response format with consistent structure

## [0.1.0] - 2026-02-05

### Added

- **Phase 0: Foundation**
  - Monorepo setup with pnpm workspaces + Turborepo
  - NestJS 10 backend with modular architecture
  - Next.js 16 frontend with App Router and React Compiler
  - PostgreSQL 16 with Prisma 7 ORM (schema separation)
  - Redis integration for caching and sessions
  - JWT authentication with refresh tokens
  - User registration and login endpoints
  - Session management (list, revoke, revoke all)
  - Environment variable validation with Zod
  - ESLint + Prettier + Husky + lint-staged
  - Commitlint with Conventional Commits
  - Feature-Sliced Design (FSD) architecture for frontend
  - Tailwind CSS 4 + shadcn/ui
  - Zustand for client state, TanStack Query for server state
  - Docker Compose for local development
  - CI/CD pipeline (lint, typecheck, test, build)
  - Health check endpoints (/health, /health/db, /health/redis)
  - Swagger/OpenAPI documentation
  - PWA support with offline capabilities
  - i18n structure with next-intl (Russian)

### Infrastructure

- GitHub Actions workflows:
  - Continuous Integration (lint, typecheck, test, build)
  - Dependabot for automated dependency updates
- Docker setup with multi-stage builds
- Issue and PR templates

## [0.0.1] - 2026-01-27

### Added

- Initial repository setup
- Basic project structure
- README with project overview
- MIT License

---

## Version History

- **0.1.0** — Foundation complete (authentication, infrastructure, tooling)
- **Unreleased** — Error handling & logging system
- **Planned** — Fitness module MVP (Phase 1)

[unreleased]: https://github.com/alex-morozov84/AMCore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alex-morozov84/AMCore/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/alex-morozov84/AMCore/releases/tag/v0.0.1
