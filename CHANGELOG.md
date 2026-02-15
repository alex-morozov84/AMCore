# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Queue Infrastructure (BullMQ):**
  - Production-ready job queue system for async operations
  - Multiple queues support (email, default) with easy extensibility
  - Job priorities (0-10), retry logic with exponential backoff
  - Delayed/scheduled jobs for future execution
  - Bull Board dashboard at `/admin/queues` for job monitoring
  - Full TypeScript support with type-safe job definitions
  - QueueService with comprehensive API (add, remove, retry, pause, resume, clean)
  - HelloWorldProcessor as example implementation
  - 23 unit tests covering all QueueService operations
  - Complete documentation in `src/infrastructure/queue/README.md`
  - Dependencies: @nestjs/bullmq, bullmq, @bull-board/api, @bull-board/nestjs
- **Email Service (Resend + React Email + FormatJS i18n):**
  - Production-ready email delivery with Resend provider
  - Provider pattern architecture (Resend for production, Mock for dev/test)
  - React Email 5 templates with TypeScript + Tailwind styling
  - Three production templates: Welcome, Password Reset, Email Verification
  - Multilingual support (RU/EN) using FormatJS (@formatjs/intl) - official React Email approach
  - ICU Message Format for translations with variable interpolation
  - Async email delivery via BullMQ (3 retries, exponential backoff)
  - Two-framework testing approach: Jest for service logic, Vitest for template rendering
  - 32 comprehensive tests (27 Jest unit + 5 Vitest integration)
  - Template rendering tests verify HTML structure and i18n in real DOM environment
  - Environment-specific configuration (RESEND_API_KEY for production)
  - Dependencies: resend, @react-email/components, @formatjs/intl, vitest, happy-dom
- **E2E Testing Infrastructure:**
  - TestContainers integration for E2E tests (PostgreSQL 16 + Redis 7)
  - 27 comprehensive E2E tests for authentication module
  - Real infrastructure testing (not mocks) for high confidence
  - Jest ESM mode configuration for modern packages (uuid@13)
  - Complete authentication flow coverage (register, login, logout, refresh, sessions)
- **100% Test Coverage for Authentication Module:**
  - TokenService: 20 unit tests (JWT generation, refresh token hashing)
  - SessionService: 28 unit tests (CRUD, rotation, cleanup)
  - AuthService: 14 unit tests (register, login, validation)
  - AuthController: 23 integration tests (HTTP endpoints, cookies)
  - QueueService: 23 unit tests (job management, queue operations)
  - Total: 167+ tests across unit, integration, and E2E levels
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
- Enhanced health checks with @nestjs/terminus integration:
  - `/health` endpoint with database, Redis, disk, and memory checks
  - `/health/ready` readiness probe for Kubernetes (external dependencies)
  - `/health/live` liveness probe for Kubernetes (self-check)
  - Custom PrismaHealthIndicator and RedisHealthIndicator
  - Built-in DiskHealthIndicator (90% threshold) and MemoryHealthIndicator
  - 7 comprehensive unit tests for health indicators
- Graceful shutdown implementation:
  - Built-in NestJS `enableShutdownHooks()` for zero-dependency solution
  - SIGTERM and SIGINT signal handlers
  - Automatic log flushing before exit
  - Clean resource cleanup (database, Redis connections)
  - Test script for local verification
  - Kubernetes-ready with proper termination handling

### Changed

- **Authentication Architecture:**
  - Replaced Passport JWT strategy with custom `RefreshTokenGuard` for refresh tokens
  - Refresh tokens are opaque strings (not JWTs), validated against PostgreSQL database
  - Access tokens remain JWT-based with `JwtAuthGuard` (Passport)
  - Clearer separation: JWT for stateless access, database lookup for stateful refresh
- Enhanced LoggerModule configuration with environment-specific log levels
- Updated exception filters to include correlation ID in all responses
- Improved error response format with consistent structure

### Fixed

- Session deletion now returns 404 for non-existent sessions (was 200)
- Added `NotFoundException` in `SessionService.deleteSession` when session not found

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
