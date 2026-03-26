# AMCore API

> Production-ready NestJS backend — authentication, RBAC, OAuth, API keys, email, queues, caching.

## Tech Stack

| Component         | Technology                                     | Purpose                            |
| ----------------- | ---------------------------------------------- | ---------------------------------- |
| **Framework**     | NestJS 10                                      | Modular monolith                   |
| **Database**      | PostgreSQL 16                                  | Primary data store (multi-schema)  |
| **ORM**           | Prisma 6                                       | Type-safe database access          |
| **Cache / Queue** | Redis + BullMQ                                 | Sessions, caching, background jobs |
| **Validation**    | Zod + nestjs-zod                               | Request validation + auto Swagger  |
| **Auth**          | JWT + Refresh Tokens, OAuth 2.0/OIDC, API Keys | Multi-method authentication        |
| **Email**         | Resend + React Email + FormatJS                | Transactional emails               |
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
│   │   ├── auth.controller.ts  # 14 endpoints
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
│   ├── email/                  # Resend + React Email + BullMQ
│   ├── queue/                  # BullMQ setup + Bull Board
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

Cross-module communication: via Redis pub/sub events, never direct DB imports.

## Authentication Endpoints

### Email Auth

| Method | Endpoint                    | Auth | Description                                |
| ------ | --------------------------- | ---- | ------------------------------------------ |
| `POST` | `/auth/register`            | —    | Register with email + password             |
| `POST` | `/auth/login`               | —    | Login, returns access token + cookie       |
| `POST` | `/auth/logout`              | 🍪   | Revoke current session                     |
| `POST` | `/auth/refresh`             | 🍪   | Rotate refresh token, get new access token |
| `GET`  | `/auth/me`                  | JWT  | Get current user profile                   |
| `POST` | `/auth/forgot-password`     | —    | Request password reset email               |
| `POST` | `/auth/reset-password`      | —    | Set new password with token                |
| `POST` | `/auth/verify-email`        | —    | Verify email with token                    |
| `POST` | `/auth/resend-verification` | —    | Resend verification email                  |

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

## Tests

**462 total:** 382 unit (40 suites) + 80 E2E (5 suites)

| Suite                | Unit                    | E2E      |
| -------------------- | ----------------------- | -------- |
| Auth (core)          | ✅                      | 42 tests |
| OAuth providers      | ✅                      | 14 tests |
| Organizations + RBAC | ✅                      | 10 tests |
| Admin                | ✅                      | 7 tests  |
| API Keys             | ✅                      | 7 tests  |
| Email templates      | Vitest (real rendering) | —        |

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

OAuth (all optional, provider enabled only when set):

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`
- Apple: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`

## Documentation

- [`docs/auth/`](../../docs/auth/README.md) — Complete auth & RBAC guide for developers
- [`docs/authorization.md`](../../docs/authorization.md) — Authorization concepts

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](../../LICENSE)
