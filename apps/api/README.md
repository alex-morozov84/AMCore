# AMCore API

> Production-ready NestJS backend — authentication, RBAC, OAuth, API keys, email, queues, caching, storage.

## Tech Stack

| Component         | Technology                                     | Purpose                            |
| ----------------- | ---------------------------------------------- | ---------------------------------- |
| **Framework**     | NestJS 11                                      | Modular monolith                   |
| **Database**      | PostgreSQL 16                                  | Primary data store (multi-schema)  |
| **ORM**           | Prisma 7                                       | Type-safe database access          |
| **Cache / Queue** | Redis + BullMQ                                 | Sessions, caching, background jobs |
| **Validation**    | Zod + nestjs-zod                               | Request validation + auto Swagger  |
| **Auth**          | JWT + Refresh Tokens, OAuth 2.0/OIDC, API Keys | Multi-method authentication        |
| **Email**         | Resend + React Email + FormatJS                | Transactional emails               |
| **Storage**       | S3-compatible + local + memory drivers         | File uploads, avatars, signed URLs |
| **Logging**       | Pino (nestjs-pino)                             | Structured JSON logging            |
| **API Docs**      | Swagger (OpenAPI)                              | Auto-generated at `/docs`          |

## Module Structure

```
apps/api/src/
├── main.ts                     # Bootstrap: Helmet, CORS, Swagger, shutdown
├── app.module.ts               # Root module composition
├── env.ts                      # Zod env validation schema
├── env/env.service.ts          # Typed env access
├── shutdown.service.ts         # Graceful shutdown
│
├── core/
│   ├── auth/                   # Authentication & authorization
│   │   ├── auth.controller.ts  # 16 endpoints
│   │   ├── auth.service.ts     # Register, login, password reset, email verification
│   │   ├── session.service.ts  # Session CRUD + rotation
│   │   ├── token.service.ts    # JWT + refresh token generation
│   │   ├── token-manager.service.ts  # Single-use tokens (reset, verify)
│   │   ├── user-cache.service.ts     # Redis cache-aside with locking
│   │   ├── login-rate-limiter.service.ts  # Brute-force protection
│   │   ├── permissions-cache.service.ts   # CASL permissions cache
│   │   ├── casl/               # AbilityFactory, condition interpolation
│   │   ├── guards/             # AuthenticationGuard, JwtAuthGuard, RefreshTokenGuard, SystemRolesGuard, PoliciesGuard
│   │   ├── decorators/         # @Auth(), @CurrentUser(), @CheckPolicies(), @SystemRoles()
│   │   ├── strategies/         # JwtStrategy (cache-first)
│   │   ├── dto/                # Zod DTOs via createZodDto()
│   │   └── oauth/              # OAuth 2.0 / OIDC
│   │       ├── oauth.controller.ts   # /providers, /:provider, /callback, /link
│   │       ├── oauth.service.ts      # findOrCreate, account linking
│   │       ├── oauth-state.service.ts  # Redis state + PKCE storage
│   │       ├── oauth-client.service.ts # openid-client ESM wrapper
│   │       └── providers/      # Google, GitHub, Apple, Telegram + factory
│   ├── api-keys/               # API key authentication
│   │   ├── api-keys.controller.ts
│   │   ├── api-keys.service.ts
│   │   └── guards/api-key.guard.ts
│   ├── organizations/          # Multi-tenant organizations
│   │   ├── organizations.controller.ts
│   │   ├── members.controller.ts
│   │   └── roles.controller.ts
│   └── admin/                  # SUPER_ADMIN only
│       └── admin.controller.ts
│
├── infrastructure/
│   ├── email/                  # Resend + React Email (direct secret sends + queued notifications)
│   ├── queue/                  # BullMQ setup + Bull Board
│   ├── storage/                # S3/local/memory storage providers + validation
│   └── schedule/               # Nightly cleanup cron
│
├── health/                     # 4 Kubernetes-ready health endpoints
├── common/
│   ├── exceptions/             # 3-layer filters + domain exceptions
│   ├── config/                 # Pino logging config
│   └── utils/                  # IP anonymization, etc.
└── prisma/
    └── prisma.service.ts
```

## Database Schema

PostgreSQL uses schema separation for module isolation:

| Schema          | Tables                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`          | users, sessions, oauth_accounts, user_settings, password_reset_tokens, email_verification_tokens, api_keys, organizations, org_members, roles, member_roles, permissions, role_permissions |
| `fitness`       | exercises, workouts, measurements (coming)                                                                                                                                                 |
| `finance`       | wallets, transactions (planned)                                                                                                                                                            |
| `subscriptions` | services, subscriptions (planned)                                                                                                                                                          |

Modules communicate through explicit service/module contracts and shared API
schemas. PostgreSQL schemas separate ownership, but do not permit direct
cross-module database access. Redis is shared infrastructure for caches, locks,
rate limits, idempotency, OAuth state, and BullMQ, not a mandatory module event
bus.

## Authentication Endpoints

### Email Auth

| Method   | Endpoint                    | Auth | Description                                     |
| -------- | --------------------------- | ---- | ----------------------------------------------- |
| `POST`   | `/auth/register`            | —    | Register with email + password                  |
| `POST`   | `/auth/login`               | —    | Login, returns access token + cookie            |
| `POST`   | `/auth/logout`              | 🍪   | Revoke current session                          |
| `POST`   | `/auth/refresh`             | 🍪   | Rotate refresh token, get new access token      |
| `GET`    | `/auth/me`                  | JWT  | Get current user profile                        |
| `PATCH`  | `/auth/me`                  | JWT  | Update own profile (name, locale, timezone)     |
| `POST`   | `/auth/me/avatar`           | JWT  | Upload validated public avatar                  |
| `DELETE` | `/auth/me/avatar`           | JWT  | Delete current avatar                           |
| `POST`   | `/auth/step-up`             | JWT  | Re-verify password to refresh step-up freshness |
| `POST`   | `/auth/forgot-password`     | —    | Request password reset email                    |
| `POST`   | `/auth/reset-password`      | —    | Set new password with token                     |
| `POST`   | `/auth/verify-email`        | —    | Verify email with token                         |
| `POST`   | `/auth/resend-verification` | —    | Resend verification email                       |

### Sessions

| Method   | Endpoint             | Auth | Description                        |
| -------- | -------------------- | ---- | ---------------------------------- |
| `GET`    | `/auth/sessions`     | JWT  | List all active sessions           |
| `DELETE` | `/auth/sessions/:id` | JWT  | Revoke specific session            |
| `DELETE` | `/auth/sessions`     | JWT  | Revoke all sessions except current |

### OAuth

| Method | Endpoint                         | Auth | Description                         |
| ------ | -------------------------------- | ---- | ----------------------------------- |
| `GET`  | `/auth/oauth/providers`          | —    | List configured providers           |
| `GET`  | `/auth/oauth/:provider`          | —    | Initiate OAuth login                |
| `GET`  | `/auth/oauth/:provider/link`     | JWT  | Initiate account linking            |
| `GET`  | `/auth/oauth/:provider/callback` | —    | OAuth callback (called by provider) |

### API Keys

| Method   | Endpoint        | Auth | Description          |
| -------- | --------------- | ---- | -------------------- |
| `POST`   | `/api-keys`     | JWT  | Create new API key   |
| `GET`    | `/api-keys`     | JWT  | List user's API keys |
| `DELETE` | `/api-keys/:id` | JWT  | Revoke API key       |

## Error Handling

All errors follow this structure:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "errorCode": "INVALID_CREDENTIALS",
  "timestamp": "2026-03-20T10:00:00.000Z",
  "path": "/api/v1/auth/login",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Stack traces are included only in development. Validation errors include a field-level `errors` array.

### Exception filter hierarchy

```
AllExceptionsFilter        ← catch-all, returns 500
  ↑
PrismaClientExceptionFilter  ← maps P2002→409, P2025→404, etc.
  ↑
HttpExceptionFilter          ← NestJS built-in exceptions
  ↑
Domain exceptions            ← NotFoundException, ConflictException, BusinessRuleViolationException
```

## Logging

Every log entry includes `correlationId`, `userId` (if authenticated), anonymized IP, `userAgent`.

Correlation ID is read from `X-Request-ID` / `X-Correlation-ID` headers, or generated as UUID v4.

IP anonymization: IPv4 last octet zeroed, IPv6 last 80 bits zeroed (GDPR compliant).

Sensitive fields automatically redacted: passwords, tokens, API keys, cookies, authorization headers.

| Environment | Level    | Format                    |
| ----------- | -------- | ------------------------- |
| Development | `debug`  | pino-pretty (colorized)   |
| Test        | `silent` | —                         |
| Production  | `info`   | JSON (Loki/Graylog-ready) |

## Health Checks

| Endpoint              | Checks                            | Use case        |
| --------------------- | --------------------------------- | --------------- |
| `GET /health`         | DB + Redis + disk + memory 300 MB | General         |
| `GET /health/startup` | DB + Redis                        | Startup probe   |
| `GET /health/ready`   | DB + Redis + disk + memory 1 GB   | Readiness probe |
| `GET /health/live`    | Memory 1.5 GB only                | Liveness probe  |

Health endpoints bypass rate limiting (`@SkipThrottle`) and are excluded from access logs.
Readiness disk usage threshold defaults to `HEALTH_DISK_THRESHOLD_PERCENT=0.9`.
Storage readiness is opt-in via `STORAGE_HEALTH_ENABLED=true`.

## Storage

The storage module is provider-agnostic and private by default.

| Driver   | Use case                             | Public URLs | Signed URLs |
| -------- | ------------------------------------ | ----------- | ----------- |
| `memory` | tests                                | no          | no          |
| `local`  | development                          | optional    | no          |
| `s3`     | production / S3-compatible providers | yes         | yes         |

Supported S3-compatible targets include AWS S3, Cloudflare R2, DigitalOcean
Spaces, Yandex Object Storage, and Backblaze B2. Upload validation uses magic
bytes through `file-type`; client MIME types are never trusted. The shipped
avatar endpoints are the public-read example consumer.

See [`../../docs/storage/README.md`](../../docs/storage/README.md).

## Tests

Run the current suite locally; counts move as the starter hardening track adds
coverage.

| Suite                | Unit                    | E2E |
| -------------------- | ----------------------- | --- |
| Auth (core)          | ✅                      | ✅  |
| OAuth providers      | ✅                      | ✅  |
| Organizations + RBAC | ✅                      | ✅  |
| Admin                | ✅                      | ✅  |
| API Keys             | ✅                      | ✅  |
| Storage              | ✅                      | ✅  |
| Email templates      | Vitest (real rendering) | —   |

```bash
pnpm --filter api test                              # all unit tests
pnpm --filter api test -- src/path/to.spec.ts       # single file
pnpm --filter api test:e2e                          # all E2E (needs Docker)
pnpm --filter api test:e2e -- oauth.e2e-spec.ts     # single E2E suite
pnpm --filter api test:email                        # email template tests (Vitest)
pnpm --filter api typecheck                         # TypeScript check
```

## Key Packages

| Package                          | Why                                                    |
| -------------------------------- | ------------------------------------------------------ |
| `openid-client` v6               | OAuth 2.0 / OIDC — panva, industry standard, zero deps |
| `@casl/ability` + `@casl/prisma` | RBAC with DB-backed permissions                        |
| `argon2`                         | Password hashing (Argon2id, OWASP recommended)         |
| `nestjs-zod`                     | Zod DTOs with auto Swagger + validation                |
| `nestjs-pino`                    | Structured logging                                     |
| `@nestjs/bullmq`                 | Background jobs + queues                               |
| `resend`                         | Email delivery                                         |
| `@react-email/components`        | Email templates                                        |

## Environment Variables

See `.env.example` in the repo root for the full list with descriptions.

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FRONTEND_URL`

OAuth (all optional, provider enabled only when fully configured; partial config fails at startup):

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`
- Apple: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`

## Deployment & Migrations

Full runbook: [`docs/operations/deployment.md`](../../docs/operations/deployment.md).
The rationale is recorded internally as ADR-040.

**Migration contract:** the app never migrates itself. Migrations run as a
**one-shot** `prisma migrate deploy` step from the production image, **before**
web/worker rollout — never on app startup, never per-replica.

- Local dev (against your dev DB): `pnpm --filter api db:migrate` (`migrate dev`).
- Production rollout: `pnpm --filter api db:migrate:prod` (`migrate deploy`) on the
  host, or `./node_modules/.bin/prisma migrate deploy` **inside** the deployed
  image (it is a single-package bundle — `pnpm --filter` does not apply there).
- The reference `docker-compose.yml` runs this via a one-shot `migrate` service
  that gates `api`/`web`.

**The migrate step needs only `DATABASE_URL`** (not JWT/storage/etc.). Use a
**direct** connection for migrations, not a PgBouncer/pooled endpoint (set
`MIGRATION_DATABASE_URL` when app traffic is pooled). Note the Prisma CLI does not
run the app's env validation, so the operator is responsible for using a secured
URL — production `DATABASE_URL` must include `sslmode=require|verify-full` (ADR-029).
In the reference `docker-compose.yml` the container's `DATABASE_URL` is rendered
from `COMPOSE_DATABASE_URL` (default: the bundled `postgres` service), kept
separate from the host `DATABASE_URL` used by `pnpm dev`.

**Production transition:** dev-friendly compose defaults are local-only. Setting
`NODE_ENV=production` requires `DATABASE_URL` with `sslmode`, `STORAGE_DRIVER=s3`

- credentials, and a real `JWT_SECRET` ≥ 32 chars.

**Adopting on an existing database:** baseline once with
`prisma migrate resolve --applied <migration_name>` so Prisma records already-applied
migrations; this is a one-time adoption step, not part of normal deploys.

**Seeding:** `pnpm --filter api db:seed` is for dev/demo only. There is no implicit
production seed — production runs `migrate deploy` and nothing else.

## Process roles (web / worker)

The same image runs as `PROCESS_ROLE=web | worker | all` (ADR-041): `web` serves
HTTP and enqueues jobs; `worker` runs BullMQ processors + cron with a health +
metrics HTTP surface; `all` (the default) is both in one process. Scale web and worker
independently from one image — see
[`docs/operations/deployment.md`](../../docs/operations/deployment.md). Roots:
`WebModule` / `WorkerModule` / `AppModule` (all), composed from
`src/app-imports.ts`.

### Adding a module

The end-to-end recipe for adding a backend module — Prisma + shared contracts +
DTO/service/controller + process-role composition + the required tests — lives in
**[`docs/backend/architecture-and-conventions.md`](../../docs/backend/architecture-and-conventions.md)**.

In short, for background work: keep `web` a pure producer. Put the BullMQ
`@Processor` (and any `@Cron`) in a **worker-only** module wired into `workerImports`,
and keep the producer/service in a module `web` can import safely. `@nestjs/bullmq`
starts a `Worker` for **any** `@Processor` in the graph, so a processor leaking into
`web` would run there too. Email is the reference (`EmailModule` producer everywhere,
`EmailWorkerModule` processor worker-only); `@Cron` only fires where `ScheduleModule`
is imported (worker/all). Assert the gating in `test/process-role.e2e-spec.ts`.

## Documentation

- [`docs/backend/architecture-and-conventions.md`](../../docs/backend/architecture-and-conventions.md) — How to add a backend module (boundaries, contracts, process roles, tests)
- [`docs/operations/deployment.md`](../../docs/operations/deployment.md) — Deployment & migration runbook
- [`docs/operations/audit-log.md`](../../docs/operations/audit-log.md) — Persistent audit log semantics and append-only model
- [`docs/operations/observability.md`](../../docs/operations/observability.md) — Metrics and tracing guide
- [`docs/auth/`](../../docs/auth/README.md) — Complete auth & RBAC guide for developers
- [`docs/authorization.md`](../../docs/authorization.md) — Authorization concepts
- [`docs/notifications/`](../../docs/notifications/README.md) — Notifications guide (in-app feed, preferences, definitions, producer contract)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](../../LICENSE)
