# Backend Architecture & Conventions

How to add a backend module to AMCore **the same way the existing ones are built**.

This guide is about _decisions and wiring_ — the sequence across Prisma, shared
contracts, NestJS modules, authorization, process roles, and tests. It deliberately
does **not** re-explain features that already have a home; it links them. If you want
to _use_ a built-in capability, start from [the feature docs](#see-also) instead.

For the high-level module tree, tech stack, and runtime layers, read
[`apps/api/README.md`](../../apps/api/README.md) first.

## Module boundaries

AMCore is a **modular monolith**. The rules that keep it modular:

- **A schema per bounded area.** `core` is the shared system foundation — auth,
  organizations, api-keys, and admin cooperate closely and may read each other's
  tables. Each distinct product or reusable capability gets its own schema
  (for example, `notifications`, `ai`, or a downstream app's domain schema).
  Every Prisma model is tagged `@@schema("<area>")`.
- **Product areas don't reach into another area's tables.** Cross-area access goes
  through an exported NestJS **service**, never a direct Prisma read of another
  area's tables. (Within the shared `core` foundation, modules may read each other.)
- **Contracts are shared, language-agnostic Zod.** Anything crossing the api/web
  boundary or representing an API request/response lives in
  [`packages/shared`](../../packages/shared/src) — a single source of truth, no
  hardcoded messages ([`AGENTS.md` → Code conventions](../../AGENTS.md)).
- **Redis is shared infrastructure, not an event bus.** It backs caches, locks, rate
  limits, idempotency, OAuth state, and BullMQ — it is not a mandatory module
  message bus.

`core/` holds domain modules (auth, organizations, api-keys, admin).
`infrastructure/` holds cross-cutting providers (email, queue, storage, redis,
webhooks, idempotency, schedule, observability). Put a new product module under
`core/` (or its own top-level area); put a reusable technical capability under
`infrastructure/`.

### Do I need CQRS?

**No — not as a default.** AMCore does **not** use a global command/query bus
(`@nestjs/cqrs`), and adopting one is not required to build a module "the right
way". The default shape is `Controller → Service → Prisma`. You already get the
healthy part of the split for free: keep methods side-effect-honest (a method
changes state _or_ returns data) and decompose a module into focused,
single-responsibility services rather than one god-service.

_Local_ command/query separation — distinct read vs. write services, or a
purpose-built read model — is fine **where read/write complexity actually
justifies it** (e.g. reporting, audit-log search, a support inbox). That is a
per-context judgement, not a mandate, and it needs no framework. Reach for a full
CQRS bus only in a bounded context with a large, measured read/write asymmetry
that must scale independently, or an event-sourcing requirement — decide that for
that context alone, never globally.

## Decide the state model first

Before writing code, classify where each piece of your module's state lives — this
drives almost every later choice:

| Kind              | Lives in           | Use for                                                       |
| ----------------- | ------------------ | ------------------------------------------------------------- |
| **Authoritative** | Postgres (Prisma)  | the source of truth; anything you must not lose               |
| **Cached**        | Redis              | a measured hot read of authoritative data (opt-in, see below) |
| **Queued**        | BullMQ             | deferred/async work; retried on failure                       |
| **External**      | Storage (S3/local) | binary objects; reference them from Postgres                  |

## The recipe — adding a module

### 1. Persistence (Prisma)

Add your models to a Prisma schema file under
[`apps/api/prisma/`](../../apps/api/prisma) (models are split by area; the generator
and datasource live in `schema.prisma`). Tag every model with `@@schema("<area>")`.
**If you introduce a new schema, add it to `datasource db { schemas = [...] }` in
`schema.prisma` first** — otherwise the migration won't create it.

Let Prisma diff the schema against your local dev DB; **don't hand-craft migration
history, and never run `migrate dev` against production:**

```bash
pnpm --filter api db:migrate                                  # prisma migrate dev (LOCAL only)
pnpm --filter api db:migrate -- --create-only --name <slug>  # emit SQL to review/edit before it applies
```

Editing the _generated_ SQL is fine and sometimes necessary (data backfills, safe
rollouts) — use `--create-only` to review it before apply; what you must not do is
author migration files by hand. Production applies migrations as a one-shot
`db:migrate:prod` ([`deployment.md`](../operations/deployment.md)), never on app
startup.

### 2. Contract (shared Zod)

Define request/response schemas in
[`packages/shared/src/schemas/<module>.ts`](../../packages/shared/src/schemas) and
export them from `schemas/index.ts`. Keep them message-free — Zod v4 native i18n
handles translation. Rebuild shared so the api/web can import it:

```bash
pnpm --filter @amcore/shared build
```

### 3. Implement: DTO → service (+ mapper) → controller → module

- **DTO** — wrap each schema with `createZodDto()` so it produces validation +
  Swagger automatically:

  ```ts
  // dto/thing-response.dto.ts
  export class ThingResponseDto extends createZodDto(thingResponseSchema) {}
  ```

- **Service** — own the Prisma access and **map raw Prisma rows to the shared
  response type**. Do not return Prisma entities from a handler; return a value typed
  to the shared contract (pattern: `api-keys.service.ts` → `findAllForUser` maps
  `keys.map((k) => ({ ... }))` into `ApiKeyListResponse`).

- **Controller** — declare the accepted auth types and a **typed success response**
  on every public handler:

  ```ts
  @Auth(AuthType.Bearer)
  @Controller('things')
  export class ThingsController {
    @Post()
    @ZodResponse({ type: ThingResponseDto, status: 201, description: 'Thing created' })
    create(@CurrentUser() user: RequestPrincipal, @Body() dto: CreateThingDto) {
      return this.thingsService.create(user.sub, dto)
    }
  }
  ```

  Typed responses are **enforced** — see [Tests](#tests).

- **Module** — compose controller + service into a NestJS module; export any service
  other modules are allowed to call.

### 4. Authentication & authorization

Every handler under `core/**` must **explicitly** declare its accepted auth types
with `@Auth(...)` — a guardrail test fails otherwise. Bearer (an interactive user
session) is the default credential; allow API keys only on handlers that should
accept them, and never for credential management or other high-risk operations. For
role/permission checks and adding your own CASL subjects, follow
[`docs/auth/rbac.md`](../auth/rbac.md) — don't reinvent it.

### 5. Register in the correct process role

The same image runs as `web`, `worker`, or `all`. Composition lives in
[`apps/api/src/app-imports.ts`](../../apps/api/src/app-imports.ts). Put each piece in
the **right** list — a misplaced processor runs in the wrong process:

- **Business HTTP module** (controllers) → `webImports`.
- **`@Processor` / `@Cron`** → a **worker-only** module → `workerImports`. NestJS
  starts a `Worker` for _any_ `@Processor` in the graph, so a processor that leaks
  into `web` via a transitive import will also run there. Keep the producer (the
  service that _enqueues_) separate from the consumer (the processor). Email is the
  reference: `EmailModule` (producer, everywhere) vs `EmailWorkerModule` (processor,
  worker only).
- **Genuinely shared infrastructure / producers** → `coreImports`.

## Cross-cutting decision points

Apply these only when your module needs them:

- **Caching — opt-in for measured hot reads, not a default.** Cache an authoritative
  read only when it is actually hot; the cost is invalidation correctness. **Do not
  cache** low-traffic data, anything you can't reliably invalidate, or values that
  must always be fresh. Pattern (cache-aside + tag invalidation + distributed lock):
  [`core/auth/user-cache.service.ts`](../../apps/api/src/core/auth/user-cache.service.ts).
- **Background jobs** — enqueue via a producer; process in a worker-only module
  (see step 5). Failure/retry semantics live with BullMQ.
- **Idempotency** — for unsafe retried writes, use the HTTP idempotency primitive
  ([`docs/operations/idempotency.md`](../operations/idempotency.md)).
- **Auditing** — record security-relevant actions in the append-only audit log
  ([`docs/operations/audit-log.md`](../operations/audit-log.md)).
- **Stable domain errors** — throw the domain exceptions in `common/exceptions`; the
  filter layers map them to a stable error contract
  ([`apps/api/README.md` → Error Handling](../../apps/api/README.md#error-handling)).
- **Concurrent mutation of external state (fencing).** If your feature publishes a
  database pointer to _versioned external state_ and later sweeps superseded objects
  (e.g. an upload-and-replace flow), a Redis lock alone is **not** a correctness
  fence — it only serializes the common case. Keep a **monotonic generation in
  Postgres**, publish with a **conditional update** (CAS), use versioned external
  keys, sweep only generations strictly older than your own, and **fail closed** when
  the lock or CAS is lost. This is the avatar pattern — read
  [`docs/media/README.md` → Concurrency](../media/README.md#concurrency) and the code
  ([`core/auth/avatar.service.ts`](../../apps/api/src/core/auth/avatar.service.ts),
  [`infrastructure/redis/redis-lock.service.ts`](../../apps/api/src/infrastructure/redis/redis-lock.service.ts))
  before designing your own. It is **not** required for every upload.

## Tests

Cover the critical paths and the project-specific gates:

- **Unit** — service logic in isolation.
- **E2E** (Jest + Testcontainers, needs Docker) — the HTTP contract end to end.
- **OpenAPI inventory** — a new public handler **must** be added to the expected
  inventory in [`apps/api/test/openapi.e2e-spec.ts`](../../apps/api/test/openapi.e2e-spec.ts).
  The check runs both ways: a handler that ships without a typed `@ZodResponse` (or
  with the wrong status) **fails CI**.
- **Process-role gating** — if you added a processor or cron, assert it runs only in
  the right role, as in
  [`apps/api/test/process-role.e2e-spec.ts`](../../apps/api/test/process-role.e2e-spec.ts).

Commands are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#api-specific-test-commands).

## See also

- Auth, RBAC, OAuth, API keys, sessions — [`docs/auth/`](../auth/README.md)
- Notifications — in-app feed, preferences, definition registry, transaction-aware producer, durable worker-driven email & Telegram channels, realtime SSE fan-out — [`docs/notifications/`](../notifications/README.md)
- AI capability layer — assistants/agents, provider/model catalog, durable runs, tools/approvals, human takeover, multimodal artifacts, security posture — [`docs/ai/`](../ai/README.md)
- Storage, uploads, signed URLs — [`docs/storage/`](../storage/README.md)
- Media / image processing — [`docs/media/`](../media/README.md)
- Deployment, migrations, process roles — [`docs/operations/deployment.md`](../operations/deployment.md)
- Idempotency, webhooks, observability, audit log — [`docs/operations/`](../operations/)
- Workflow, commit format, test commands — [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
- Code conventions — [`AGENTS.md`](../../AGENTS.md)
