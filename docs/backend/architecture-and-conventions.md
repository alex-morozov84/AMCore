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

AMCore uses Prisma 7's source-generated client (`provider = "prisma-client"`,
`output = "../src/generated/prisma"`). Runtime API code imports Prisma enums,
types, and `PrismaClient` from `@/generated/prisma/client`, not from the
deprecated `@prisma/client` generated package surface. The generated directory is
created by `pnpm --filter api db:generate` / API `postinstall` before
typecheck/build/test.

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
export them from `schemas/index.ts`.

**Keep them message-free.** A literal `message` outranks the frontend's
per-parse error map (Zod precedence: schema-level → per-parse → global →
locale), so it silently forces English into a localized UI. When a refinement
needs a specific meaning, attach a code instead:

```ts
ctx.addIssue({
  code: 'custom',
  params: { errorCode: ApiKeyScopeErrorCode.API_KEY_SCOPE_UNKNOWN_ACTION },
})
```

The frontend translates that code through the same catalogue it uses for API
errors — see
[`docs/frontend/i18n-and-errors.md`](../frontend/i18n-and-errors.md). Raw API
consumers branch on `errorCode`; `errors[].message` is diagnostic only.

**Test the schema's own validation boundary beside it**, in
`packages/shared/src/schemas/<module>.test.ts` (Vitest) — accepted/rejected
inputs, defaults, and any custom `errorCode`. It runs standalone against the
schema's source, with no NestJS/DTO/HTTP setup, and the same module both the
api DTO and any frontend form import validates identically. Don't duplicate
this coverage as an `apps/api` Jest spec.

Rebuild shared so the api/web can import it:

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

- **Controller** — declare the accepted auth types, matching Swagger auth metadata,
  and a **typed success response** on every public handler:

  ```ts
  @ApiTags('things')
  @ApiBearerAuth()
  @Auth(AuthType.Bearer)
  @Controller('things')
  export class ThingsController {
    @ApiOperation({ summary: 'Create a thing' })
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

If a handler accepts API keys, add it to the ADR-034 allowlist
(`apps/api/src/core/auth/decorators/adr-034-api-key-allowlist.ts`) and document
the operation with `@ApiSecurity('apiKeyBearer')` at the **handler level**. Do
not put `apiKeyBearer` on the controller class: `@nestjs/swagger` concatenates
class and method security metadata, so class-level API-key metadata leaks onto
bearer-only handler overrides. The OpenAPI e2e test checks this allowlist in
both directions.

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

## Adding an environment variable

Env is validated once at boot by a Zod schema. It is split into domain sections
under [`apps/api/src/env/schema/`](../../apps/api/src/env/schema) (one `*.env.ts`
per area), composed flat in `base.ts`, with cross-field logic in `refinements/`.
`apps/api/src/env.ts` is a re-export shim, so consumers keep importing from `@/env`.

1. **Declare it** in the matching section (e.g. `storage.env.ts`) as a Zod field:
   - a safe fallback → `.default(...)` (the app runs without the operator setting it);
   - an optional feature credential → `optionalEnvString()` / `optionalEnvUrl()`;
   - genuinely required (no safe default) → no `.default()`/`.optional()` — the app
     refuses to boot without it.
2. **Cross-field behavior**, if any, goes in `refinements/` — a value derived from
   other fields in `derive-defaults.ts`; a "set one → set all" group or conditional
   requirement in `provider-rules.ts` / `resource-rules.ts`. Keep each rule small and
   single-domain.
3. **Document it** in the root [`.env.example`](../../.env.example), in the matching
   section: **active** (`KEY=value`) for required/common starter keys, **commented**
   (`# KEY=default`) for optional/advanced knobs. This is enforced —
   [`env-example-coverage.spec.ts`](../../apps/api/src/env/schema/env-example-coverage.spec.ts)
   **fails CI** if a schema key is undocumented, or a documented key is not a schema
   key (only compose-only vars like `COMPOSE_*`/`MIGRATION_DATABASE_URL` and dynamic
   `WEBHOOK_*_SECRET` are allow-listed).
4. **Pass it to containers** that need it at runtime via `x-app-env` in
   [`docker-compose.yml`](../../docker-compose.yml).
5. **Read it** type-safely through `EnvService.get('KEY')` — never `process.env`
   directly (the only exceptions are the bootstrap-time flags read before
   `ConfigModule`, documented in code where they occur).

## Adding an external service / infra dependency

A backing service (a third-party API client, an object store, a message broker)
is wired as a small NestJS provider/module — same boundaries as a feature module,
plus these seams:

1. **Config, not literals.** Endpoints, credentials, and toggles come from the env
   schema (above), read via `EnvService`. Never hardcode a host or key. Gate an
   optional integration behind an "enabled" check so the app still boots without it.
2. **Own a client, expose a service.** Construct the SDK/client once in a provider
   (its lifetime tied to the module), and expose a thin service with the operations
   your modules need — don't leak the raw client. Storage is the reference: a driver
   interface (`s3` / `local` / `memory`) selected by config, with a stable service
   surface.
3. **Health.** If the app's readiness depends on it, contribute a health indicator
   (see the storage health probe) — behind an opt-in flag when the check has a cost.
   Don't fail liveness on a non-critical dependency.
4. **Lifecycle.** Release sockets/handles on shutdown via `OnModuleDestroy`
   (Nest already runs shutdown hooks — see `main.ts`), so `SIGTERM` drains cleanly
   and tests don't leak handles.
5. **Process role.** Put the module in the right list (see step 5 of the module
   recipe): a producer/shared client → `coreImports`; a consumer that only runs work
   → a worker-only module.
6. **Tests.** Unit-test the service against a faked client; prefer an in-process fake
   or a `memory` driver for e2e over a network dependency. Reserve real-service e2e
   for an env-gated, opt-in suite.

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
- **Rate limiting — every route is protected for free; override through
  `@RateLimit`/`@SkipRateLimit`.** `infrastructure/throttling/` owns the
  entire mechanism (ADR-039/ADR-073): a GCRA (Generic Cell Rate Algorithm)
  limiter, Redis-backed with an in-memory degrade path, its own guard —
  there is no third-party rate-limit library at all, so there is nothing
  to learn beyond this decorator pair.
  - **Override a route** with `@RateLimit(policy)` — either a named policy
    from `RATE_LIMIT_POLICIES` (`PRIVILEGED_MUTATION`, `EXPENSIVE_ACTION`)
    or an inline `{ rate, per, burst? }` (see the Telegram webhook
    controller for an inline example). This is a coarse per-visitor
    volumetric backstop, not precise per-actor protection — that's what
    dedicated limiters (`LoginRateLimiterService`, invite-accept, etc.)
    are for.
  - **Exempt a route** with `@SkipRateLimit()` (health/metrics probes only,
    normally).
  - **Buckets are per-route-per-visitor, precisely.** One visitor calling
    several _different_ routes doesn't share one budget — each route
    tracks its own bucket independently, completely unaffected by that
    visitor's traffic to any other route. One visitor calling the _same_
    route many times rapidly shares that route's budget. This precision
    only holds for real visitors once `TRUSTED_WEB_PEERS` +
    `WEB_TRUSTED_CLIENT_IP_HEADER` are configured (ADR-072) — see
    [`docs/frontend/api-consumption.md`](../frontend/api-consumption.md) →
    "Client-IP relay to `apps/api`"; without them every BFF-proxied visitor
    still shares one bucket.
  - **A policy has a sustained `rate` and an instantaneous `burst`** (the
    number of requests admitted immediately from idle, above the sustained
    rate — defaults to `rate` when omitted). This is what makes normal
    browsing safe by default: one real visitor's page firing several
    parallel calls to the same route, or clicking through a filterable
    list quickly across a few page visits, is absorbed by `burst` without
    tripping the backstop — while a route called continuously well above
    its sustained `rate` still gets throttled. `DEFAULT`'s `burst: 50`
    means an idle visitor can fire up to 50 requests to one route
    instantly and still be admitted; a fixed-window algorithm cannot
    express this distinction at all (see "Why GCRA, not fixed-window"
    below).
  - **Classifying a new route** (stop at the first match):
    1. Does it need per-actor/per-identity protection rather than a
       per-visitor volumetric one (login, invite-accept, password reset)?
       Use a dedicated limiter, not `@RateLimit`.
    2. Is it fine under the global default? Add no decorator — that's the
       common case.
    3. Is it unusually expensive (heavy DB/CPU work) or privileged
       (destructive/admin) but rarely called in bursts by a legitimate
       user? Narrow it with `@RateLimit(RATE_LIMIT_POLICIES.EXPENSIVE_ACTION)`
       or `.PRIVILEGED_MUTATION`, or an inline policy with cited evidence
       for the chosen numbers (see the Telegram webhook controller).
    4. Is it a public, unauthenticated ingress needing its own bounded rate
       distinct from the global default (a webhook)? Inline `@RateLimit`
       with a comment naming the source's documented rate, never
       `@SkipRateLimit()`.
    5. Does one legitimate user action _legitimately_ fan out into many
       rapid calls to the _same_ route (e.g. a filterable list a user
       clicks through quickly)? This is exactly what `burst` exists for —
       size it to the real fan-out with cited evidence, don't widen `rate`
       (the sustained ceiling) to paper over it.
  - **Never widen the global `DEFAULT` policy** to work around a specific
    route's fan-out — that weakens the backstop for every route to fix a
    problem only one route has; narrow a specific route's policy instead.
  - **Why GCRA, not fixed-window.** A fixed-window counter (what this
    mechanism used before ADR-073) can only express one number — a limit
    per window — so it cannot distinguish a one-time burst from an idle
    visitor from the same request count arriving continuously, request
    after request, from an attacker. No amount of `@RateLimit` tuning
    fixes that; only a capacity-aware algorithm can. GCRA is that
    algorithm — see ADR-073 for the full rationale, the default policy
    table, and a measured before/after (the exact originally-reported
    production symptom this mechanism exists to prevent: 28 of 60
    requests refused under the old fixed-window defaults, 0 of 60 under
    this one, for the identical traffic pattern — permanent regression
    coverage in `apps/api/test/rate-limit-symptom-reproduction.e2e-spec.ts`).

## Tests

Cover the critical paths and the project-specific gates:

- **Unit** — service logic in isolation.
- **Shared contract** (Vitest, `packages/shared`) — a new or changed Zod
  schema's own validation-boundary test lives beside it, per step 2 above.
- **E2E** (Jest + Testcontainers, needs Docker) — the HTTP contract end to end.
- **OpenAPI inventory** — a new public handler **must** be added to the expected
  inventory in [`apps/api/test/openapi.e2e-spec.ts`](../../apps/api/test/openapi.e2e-spec.ts).
  The check runs both ways: a handler that ships without a typed `@ZodResponse` (or
  with the wrong status) **fails CI**.
- **OpenAPI security/multipart guardrails** — API-key-capable handlers must match
  the shared ADR-034 allowlist and document `apiKeyBearer`; upload handlers that
  use `FileInterceptor('file', ...)` must document `multipart/form-data` with a
  binary `file` request body. Both are asserted in
  [`apps/api/test/openapi.e2e-spec.ts`](../../apps/api/test/openapi.e2e-spec.ts).
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
