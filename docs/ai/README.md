# AI Capability Layer

AMCore ships a reusable, **provider-agnostic AI backend foundation** on its own
`ai` Postgres schema — an AMCore-owned control plane for model selection, durable
AI runs, usage/cost accounting, prompt-injection containment, a self-hosted
tool/agent loop, conversation persistence, and human takeover. It is the _engine_
of an AI assistant, **not** an applied product bot: like the notification
subsystem, the reusable core ships here and applied assistants are deferred
consumers.

> **Status — foundational (Track C, arc-phased).** Arc A shipped the persistence
> schema and shared contracts; **Arc B adds the runtime `ModelGateway` and catalog
> registry** — provider-agnostic text generation and structured output over a
> DB-backed catalog, with usage accounting and content-free metrics. The gateway is
> **not yet wired to an HTTP surface**: the durable run worker, run API, guardrails,
> tool loop, human takeover, and multimodal routing land in later arcs (C–G), each
> additive over what is documented here. Sections marked _(later arc)_ describe the
> intended shape those arcs build toward.

## Design Principles

| Principle                                             | What it means                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider-agnostic out of the box**                  | Anthropic/Claude, OpenAI, OpenRouter, Yandex AI Studio, and any OpenAI-compatible endpoint are first-class. **Claude is the shipped default model, not the only one.** Adding a provider/model is a catalog row + key, not a code change — except the adapter for a genuinely new provider _family_.              |
| **AMCore owns the control plane**                     | Postgres is authoritative for the catalog, conversations, runs, tool invocations, approvals, artifacts, and the usage ledger. Redis is admission/cache/realtime infrastructure; BullMQ is a wake path with worker-only Postgres-driven recovery (the durable-job pattern reused from the notification subsystem). |
| **Model output is untrusted**                         | Output is never executed, sent externally, or treated as authority without schema validation, a tool allowlist, approval policy, and audit. Prompt text, user files, provider responses, API keys, and tool results are never written to logs/metrics/audit metadata unless explicitly redacted and allowlisted.  |
| **Prompt-injection containment, not a silver bullet** | The design follows OWASP LLM01 defense-in-depth: a structural trust boundary between trusted instructions and untrusted user/tool/file content, output validation, least-privilege tools, and human-in-the-loop approval. It is mitigated and contained, **never claimed eliminated**.                            |
| **Admin-manageable catalog**                          | Providers, models, policies, and assistant configs are DB-backed, admin-editable state. The engine-side admin contracts ship now; the admin UI is deferred to the frontend phase.                                                                                                                                 |

## Persistence (shipped — Arc A)

Own `ai` Postgres schema, split into bounded-context Prisma files:

| File                             | Models                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/ai-catalog.prisma`       | `AiProvider`, `AiModel`, `AiModelPolicy`, `AiAssistant` — the admin-manageable catalog.                                                                    |
| `prisma/ai-conversations.prisma` | `AiConversation` (with the `controlledBy` / `ownershipGeneration` takeover fence), `AiMessage` (durable transcript).                                       |
| `prisma/ai-runs.prisma`          | `AiRun` (durable state machine; lease/retry columns are laid but inert until the worker arc), `AiRunStep` (append-only iteration trail).                   |
| `prisma/ai-tools.prisma`         | `AiToolInvocation`, `AiApproval` — the self-hosted tool loop + human-in-the-loop record.                                                                   |
| `prisma/ai-artifacts.prisma`     | `AiArtifact` — multimodal input/output with an explicit `trustLevel`.                                                                                      |
| `prisma/ai-usage.prisma`         | `AiUsageLedger` — the authoritative usage/cost record, a **snapshot/no-FK accounting record** (like the audit log) so it survives user/org/model deletion. |

Key invariants baked into the schema now so later arcs are additive:

- **Provider `type` is a closed enum** (`anthropic`, `openai`, `openrouter`,
  `openai_compatible`, `yandex_ai_studio`, `mock`) — each value is code-bound to a
  gateway adapter. Capabilities, modalities, and use cases are **open bounded
  strings**, so a new capability is a data change, never a migration.
- **No secret is stored in the catalog.** A provider references a logical
  `credentialSlot`, resolved at runtime through a code-owned per-type allowlist —
  never a raw env-var name, so a catalog row cannot point at an unrelated secret.
- **Durable runs follow the notification durability pattern**: Postgres owns the
  run state machine, lease, and retry schedule; the worker recovers directly from
  Postgres (a lost wake is still drained).
- **Human takeover is TOCTOU-safe**: a monotonic `ownershipGeneration` fence stops
  a stale bot run from writing into a human-owned conversation.

## Shared Contracts (shipped — Arc A)

Language-agnostic Zod schemas in [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/)
(`ai-common`, `ai-enums`, `ai-catalog`, `ai-assistants`, `ai-runs`), the single
source of truth for both API and (future) web:

- **Vocabulary** — bounded slug/identifier grammars, the closed provider-type enum,
  the bounded **capability map**, modalities, a precision-safe **decimal string**
  for cost, and a bounded **non-secret config object** (rejects secret-looking keys).
- **Wire enums** — the lowercase projection of every lifecycle enum (run status,
  conversation state/control, message role, author type, tool risk/status,
  approval, artifact kind/trust); the API never leaks `SCREAMING_CASE` DB tokens.
- **Catalog** — provider/model/policy/assistant read projections + admin
  create/update inputs (the engine-side of the admin catalog).
- **Runs** — the **multimodal content-part contract** (`text` | `artifact_ref`,
  additive), conversation/message/run/artifact read projections, the minimal
  run-creation request, and the usage summary.

Pagination, streaming-event, tool-invocation, and approval request contracts are
deliberately deferred to the arcs that ship those endpoints — they are not
speculated here.

## Runtime: ModelGateway + Catalog Registry (shipped — Arc B)

The `ModelGateway` (`apps/api/src/infrastructure/ai/gateway/`) is AMCore's provider-agnostic
generation seam. It is **not yet exposed over HTTP** — Arc C adds the durable run worker and run
API that call it. What it provides today:

- **`generateText(request)`** — non-streaming text over the resolved model. `request.modelSlug`
  selects a catalog model; omitted, the **credential-gated default** is used (the `isDefault`
  model if its provider has a key, else the key-less `mock`).
- **`generateObject(request, schema)`** — structured output validated against a Zod schema,
  **capability-gated**: the model must declare `structured_output` and its adapter must support it
  (the key-less mock does not). For OpenAI-compatible providers this sends a real
  `response_format: json_schema`, not a degraded JSON mode.
- **DB-backed registry** (`registry/`) — resolves the admin catalog into secret-free shapes with a
  bounded Redis snapshot cache (`AI_CATALOG_CACHE_TTL_SECONDS`) + explicit invalidation. Every row
  is re-validated against the bounded shared schemas before use; a structurally bad row is skipped.
- **Providers** (`gateway/providers/`) — a deterministic key-less `mock` plus two SDK-backed
  adapters over the Vercel AI SDK: Anthropic, and one OpenAI-compatible adapter serving OpenAI,
  OpenRouter, Yandex AI Studio, and any compatible endpoint. **Per-family base URL and auth are
  code-owned** (Yandex uses `Authorization: Api-Key …`); a catalog `baseUrl` is honored **only** for
  the generic `openai_compatible` type, so a tampered row can never redirect a credential.
- **Credential resolution** — a catalog row's logical `credentialSlot` is mapped to a fixed env key
  through a code-owned per-type allowlist; a slot value never indexes the environment directly.
- **Bounded error taxonomy** — every failure is normalized to a machine-readable code
  (`model_not_found`, `model_not_configured`, `provider_timeout`, `provider_unavailable`,
  `provider_rejected`, `content_filtered`, `capability_unsupported`, `output_validation_failed`)
  with a `retryable` flag; raw provider errors never surface. The SDK's own retry is disabled —
  retry is Postgres-owned at the durable-run layer (Arc C).
- **Usage + telemetry** — each successful generation appends an `AiUsageLedger` row (token counts +
  attribution snapshot; best-effort, never breaks the result) and increments content-free metrics
  (`amcore_ai_generations_total`, `amcore_ai_tokens_total`). No prompt/response content, model slug,
  or credential is ever a metric label or a log field; the SDK's OpenTelemetry hook is left off.

### Configuration

Secrets only — the catalog itself is DB-backed. All are optional; an enabled provider with no key
is gated out at runtime and the gateway falls back to `mock`.

| Env var                                                                                     | Purpose                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                                                         | Anthropic / Claude (the default provider)                   |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `YANDEX_API_KEY` / `AI_OPENAI_COMPATIBLE_API_KEY` | the OpenAI-shaped families (disabled examples by default)   |
| `AI_REQUEST_TIMEOUT_MS`                                                                     | per-request provider-call bound (default 60000, max 300000) |
| `AI_CATALOG_CACHE_TTL_SECONDS`                                                              | catalog snapshot cache TTL (default 300, max 3600)          |

## Seeded Catalog

`pnpm --filter api db:seed` (idempotent) seeds the intended configuration shape so
a fresh fork sees it without live keys:

- **`mock`** — enabled, key-less, deterministic (the dev/test provider).
- **`anthropic`** — enabled; **`claude-default` (`claude-opus-4-8`) is the default
  model**. The gateway gates it on a real key and falls back to `mock` when none is
  configured.
- **`openai` / `openrouter` / `local-openai-compatible` / `yandex-ai-studio`** —
  disabled examples showing how to wire each family (enable one by adding a key/config).

## Coming in Later Arcs

| Arc | Adds _(later arc)_                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C   | Durable run worker (BullMQ wake + Postgres claim/lease/recovery), run create/fetch/list/cancel HTTP surface, SSE run-status stream (reusing the realtime fan-out). |
| D   | Guardrail baseline: the structural trust-boundary prompt builder, input/output guards, and an adversarial prompt-injection corpus.                                 |
| E   | Self-hosted tool loop with per-tool Zod schemas, allowlists, risk classes, and human-in-the-loop approvals (no product tools).                                     |
| F   | Assistant registry admin contract + human takeover / operator review (transcript, take/release control).                                                           |
| G   | Multimodal foundation: storage-backed file/image/PDF artifacts with capability-gated routing.                                                                      |

## See Also

- Backend architecture & conventions — [`docs/backend/architecture-and-conventions.md`](../backend/architecture-and-conventions.md)
- Notification durability pattern the run worker reuses — [`docs/notifications/README.md`](../notifications/README.md)
- Shared schemas — [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/)
