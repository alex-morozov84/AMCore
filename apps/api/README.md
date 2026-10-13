# AMCore API

`apps/api` is the reusable backend core of AMCore: a production-oriented NestJS
modular monolith with auth/RBAC, organizations, API keys, storage/media,
notifications, email, AI capabilities, audit, observability, and production
operations.

This file is the backend entrypoint. Feature contracts live in `docs/`; endpoint
shape is generated from Swagger/OpenAPI at `/docs` in development.

## Runtime Stack

| Area           | Baseline                                                     |
| -------------- | ------------------------------------------------------------ |
| Framework      | NestJS 12 + Fastify 5                                        |
| Database       | PostgreSQL 18, Prisma 7, schema-per-area modularity          |
| Cache / queues | Redis, BullMQ                                                |
| Validation     | Shared Zod contracts + native Standard Schema metadata       |
| Auth           | JWT/refresh sessions, OAuth/OIDC, API keys, CASL permissions |
| Email          | Resend/mock providers, React Email, FormatJS                 |
| Storage        | S3-compatible, local, and memory drivers                     |
| Observability  | Pino logs, Prometheus metrics, health probes                 |
| Rate limiting  | Redis-backed GCRA global backstop with per-route policies    |

See [request/response schemas](../../docs/backend/schema-validation.md) for explicit
parameter metadata, typed responses and OpenAPI conversion.

## Commands

```bash
pnpm --filter api dev
pnpm --filter api test
pnpm --filter api test -- src/path/to.spec.ts
pnpm --filter api test:e2e
pnpm --filter api test:e2e --runTestsByPath test/oauth.e2e-spec.ts
pnpm --filter api test:email
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api build
```

Local development migrations use `pnpm --filter api db:migrate` (`prisma
migrate dev`). Production uses `db:migrate:prod` / `prisma migrate deploy` from
the CLI-capable migrator image as a one-shot step before the slim app image
rollout. See
[`docs/operations/deployment.md`](../../docs/operations/deployment.md).

## Test compiler and type checking

API unit tests use Jest with SWC CommonJS transformation. API E2E uses Jest
with SWC ESM transformation in a fresh supervised process per suite.
`jest-swc.config.cjs` shares decorator metadata, target and source-map settings.
Run `pnpm --filter api typecheck` separately: SWC does not check types.

Email template tests retain Vitest, happy-dom and `vitest.config.ts`.
`test:email:watch`, `test:email:ui` and `test:email:cov` remain separate commands.
API coverage uses `test:cov` and writes text/lcov/html to `coverage`;
email coverage writes to `coverage-email`. No API coverage threshold is configured.
Watch API unit tests with `pnpm --filter api test:watch`.

The managed E2E launcher rejects forced exits, signals, retries and incomplete
reports. A passed assertion does not excuse an unclosed timer or connection.
See [API Testcontainers](../../docs/operations/local-stands.md#api-testcontainers).

## HTTP runtime

Fastify is the only production HTTP adapter. The same bootstrap serves `web`,
`all` and the worker’s health-and-metrics HTTP surface. Express packages are development
controls for focused compatibility tests, not a configurable production fallback.
See [HTTP runtime](../../docs/backend/http-runtime.md) for plugins, extension
patterns, maintained upgrade checks, performance limits and rollback.

## Request bodies

See the [request body contract](../../docs/backend/request-body-contract.md) for parser refusals,
Unicode/form handling, decoded limits and connection recovery. Route validation/auth remain separate.

## Source Map

```text
apps/api/src/
  main.ts                 # bootstrap: HTTP, Swagger, shutdown
  swagger.config.ts       # shared OpenAPI config for runtime docs + e2e guard
  app.module.ts           # all-in-one composition
  web.module.ts           # web process composition
  worker.module.ts        # worker process composition
  app-imports.ts          # shared/web/worker import lists
  env.ts                  # compatibility re-export for @/env imports
  env/                    # Zod env schema sections, EnvModule, EnvService
  generated/prisma/       # Prisma 7 source-generated client (build artifact)
  core/                   # domain modules and HTTP surfaces
  infrastructure/         # cross-cutting providers and adapters
  common/                 # filters, logging config, utilities
  health/                 # health/readiness/liveness endpoints
  prisma/                 # Prisma service and generated access
```

Important areas:

| Path                                                             | Owns                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `core/auth`, `core/organizations`, `core/api-keys`, `core/admin` | shared application foundation                                                     |
| `core/notifications`                                             | in-app feed, preferences, realtime hints, durable external delivery               |
| `core/ai`                                                        | AI HTTP surface: conversations, runs, approvals, assistants, operators, artifacts |
| `infrastructure/email`                                           | React Email rendering, providers, queue worker, direct secret sends               |
| `infrastructure/storage`, `infrastructure/media`                 | object storage and image processing primitives                                    |
| `infrastructure/queue`, `infrastructure/schedule`                | BullMQ, Bull Board, cron coordination                                             |
| `infrastructure/throttling`                                      | GCRA rate-limit guard, Redis/memory limiters, `@RateLimit`/`@SkipRateLimit`       |

## Module Boundaries

AMCore is a modular monolith. Add product domains as bounded modules, usually
with their own Prisma schema. Cross-module access goes through exported NestJS
services, not direct reads of another area's tables.

For the full recipe — Prisma, shared Zod contracts, DTOs, controllers, process
roles, auth, tests, OpenAPI inventory — use
[`docs/backend/architecture-and-conventions.md`](../../docs/backend/architecture-and-conventions.md).

## Process Roles

The same image can run as:

- `PROCESS_ROLE=web` — HTTP controllers and producers.
- `PROCESS_ROLE=worker` — BullMQ processors, cron, worker health/metrics.
- `PROCESS_ROLE=all` — both roles in one process; useful locally.

Keep processors and cron in worker-only modules. A leaked `@Processor` starts a
BullMQ worker anywhere it appears in the Nest graph. The import split lives in
`src/app-imports.ts`; process-role gates are tested in
`apps/api/test/process-role.e2e-spec.ts`.

## Error Handling

Public errors are stable machine-readable responses:

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

Stack traces are development-only. Validation errors include field-level
`errors`. Domain exceptions flow through the filter stack in `common/exceptions`
before reaching the HTTP response.

`errorCode` is the stable field. **`message` is diagnostic English for
developers and raw API consumers — clients must not display it**; they translate
by code. Adding a code to a shared enum without translating it fails the web
build. See
[`docs/frontend/i18n-and-errors.md`](../../docs/frontend/i18n-and-errors.md).

Any link this API puts in front of a user — email CTA, notification, OAuth
redirect — must be built with `localizedFrontendUrl()` from `@amcore/shared`,
never concatenated from `FRONTEND_URL`: web routes are locale-prefixed and an
emailed link cannot fall back to a browser cookie. A test enforces it per
occurrence.

## Logging and Metrics

Logs are structured Pino JSON with correlation IDs, sensitive-field redaction,
and anonymized client IPs. Prometheus metrics use bounded labels and must not
carry IDs, emails, object keys, prompts, provider bodies, or free-form content.
See [`docs/operations/observability.md`](../../docs/operations/observability.md).

## Documentation Map

- All docs by intent — [`docs/README.md`](../../docs/README.md)
- Backend module recipe — [`docs/backend/architecture-and-conventions.md`](../../docs/backend/architecture-and-conventions.md)
- Auth, sessions, OAuth, RBAC, API keys — [`docs/auth/`](../../docs/auth/README.md)
- Authorization concepts — [`docs/auth/rbac.md`](../../docs/auth/rbac.md)
- Email extension contract — [`docs/email/`](../../docs/email/README.md)
- Notifications — [`docs/notifications/`](../../docs/notifications/README.md)
- AI capability layer — [`docs/ai/`](../../docs/ai/README.md)
- Storage and media — [`docs/storage/`](../../docs/storage/README.md), [`docs/media/`](../../docs/media/README.md)
- Deployment, migrations, process roles — [`docs/operations/deployment.md`](../../docs/operations/deployment.md)
- TLS / reverse proxy / Caddy / `TRUST_PROXY` — [`docs/operations/deployment.md`](../../docs/operations/deployment.md#tls--reverse-proxy)
- Postgres backup & restore — [`docs/operations/backup-restore.md`](../../docs/operations/backup-restore.md)
- Audit, observability, idempotency, webhooks, CI/dependency security — [`docs/operations/`](../../docs/operations/README.md)
- Contributor commands and PR flow — [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
