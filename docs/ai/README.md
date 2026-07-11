# AI Capability Layer

AMCore ships a reusable, **provider-agnostic AI backend foundation** on its own
`ai` Postgres schema — an AMCore-owned control plane for model selection, durable
AI runs, usage/cost accounting, prompt-injection containment, a self-hosted
tool/agent loop, conversation persistence, and human takeover. It is the _engine_
of an AI assistant, **not** an applied product bot: like the notification
subsystem, the reusable core ships here and applied assistants are deferred
consumers.

> **Status — foundational (Track C, arc-phased).** Arc A shipped the persistence
> schema and shared contracts; Arc B added the runtime `ModelGateway` and catalog
> registry; Arc C wired the durable run worker and the run HTTP surface (bearer
> conversation/run create/fetch/list/cancel plus a status-only SSE stream); Arc D added
> the prompt-injection guardrail baseline — a structural trust boundary, input/output
> guards, safe refusals, and an adversarial corpus gate; **Arc E adds the bounded self-hosted
> tool loop + human-in-the-loop approvals** (code-owned tool registry, worker-only host-side
> execution, durable `waiting_approval` park/resume, no product tools). Human takeover and
> multimodal routing land in later arcs (F–G), each additive over what is documented here.
> Sections marked _(later arc)_ describe the intended shape those arcs build toward.

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
generation seam. It is **worker-only** — the durable run worker (Arc C, below) is its sole caller,
so provider-call capability never enters the web DI graph. What it provides:

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

## Durable Runs + Run API (shipped — Arc C)

Arc C wires the gateway into a **durable run engine** and a bearer-authenticated HTTP surface. A run
is a Postgres-owned unit of work: the **web** role creates and reads it; the **worker** role executes
it (the only role that calls a provider). It reuses the notification durability pattern (ADR-052) —
BullMQ is a wake hint, Postgres owns the claim, lease, retry schedule, and recovery.

### Run lifecycle

```
QUEUED ──claim(SKIP LOCKED)──▶ RUNNING ──finalize(CAS)──▶ COMPLETED
   │                              │                  └────▶ FAILED       (permanent provider error / exhausted)
   │                              ├──────────────────────▶ CANCELLED    (cooperative cancel observed)
   │                              └──────────────────────▶ EXPIRED      (deadline passed)
   └── retry (transient error / lost lease) ── nextAttemptAt ──▶ QUEUED
```

- **Create** persists the user turn (`AiMessage` bound to the run by `runId`) and a `QUEUED` `AiRun`
  in one transaction, freezes a **secret-free model snapshot** (the credential-gated default →
  `mock` without a key), and fires a best-effort post-commit wake. Creation is idempotent on
  `(conversationId, idempotencyKey)`.
- **Execute** (worker) claims a due run under `FOR UPDATE SKIP LOCKED`, leases it (10-min TTL),
  loads the run's own input turn, resolves the model from the frozen `modelSnapshot.modelSlug`
  (never the current default), calls `generateText` **exactly once**, and finalizes in **one
  transaction**: the assistant `AiMessage` + bounded `AiRunStep`s + a run-attributed `AiUsageLedger`
  row + the terminal-status CAS.
- **Recover** — a per-replica `@Cron` (not Redis-locked; the DB claim is the mutex) drains due runs
  even if a wake was lost, and a reaper reclaims leases from crashed workers.

**Retry is Postgres-owned** (`maxAttempts` = 3, exponential backoff with jitter; the gateway
`retryable` flag decides retry vs terminal; the SDK's own retry stays disabled). **Cancellation is
cooperative**: a `QUEUED` run cancels immediately (terminal), a `RUNNING` run records the request and
the executor honors it before the provider call.

**At-least-once provider effect, exactly-once durable outcome.** If a provider call succeeds but the
finalize transaction fails, the run is left non-terminal — recovery retries and may call the provider
again. The durable outcome (assistant turn + ledger + terminal status) is exactly-once because it
shares one CAS transaction; success is never faked without a durable transcript + ledger.

### HTTP surface (bearer, owner-scoped by `conversation.ownerUserId`)

| Method + path               | Purpose                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `POST /ai/conversations`    | Create a conversation.                                                         |
| `GET /ai/conversations/:id` | Fetch an owned conversation.                                                   |
| `POST /ai/runs`             | Queue a run on a conversation (idempotent; the worker executes it).            |
| `GET /ai/runs/:id`          | Fetch an owned run's status.                                                   |
| `GET /ai/runs`              | Keyset-paginated owned runs (`?conversationId=&cursor=&limit=`, newest first). |
| `POST /ai/runs/:id/cancel`  | Cooperatively cancel an owned run.                                             |
| `GET /ai/runs/:id/stream`   | **Status-only** SSE stream of run-status hints (see below).                    |

A missing or not-owned conversation/run is a `404` so existence never leaks.

### Status-only SSE run stream

`GET /ai/runs/:id/stream` is an AI-scoped copy of the realtime primitives (ADR-053): a dedicated
Redis Pub/Sub subscriber per web replica → a process-local hub → a manually-written bounded
`text/event-stream`. The worker publishes a **content-free** hint on each status change; the event
carries only `{ eventId, runId, status, reason }` — **no prompt, response, token chunk, provider
body, model slug, or credential**.

- **This is not token streaming.** The event is a signal to **refetch** `GET /ai/runs/:id`; Postgres
  is the source of truth. Token streaming is deferred.
- **At-most-once** across replicas (Redis Pub/Sub, no sticky sessions); a missed hint is repaired on
  the client's next reconnect/refetch. The stream closes at the bearer token's expiry (bounded by a
  hard server cap), and admission enforces per-user (`429`) and global (`503`) caps before any bytes.

### Configuration (Arc C)

Realtime knobs (all optional; an AI-scoped copy of the notification realtime knobs):

| Env var                                                               | Purpose                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `AI_REALTIME_NAMESPACE`                                               | channel namespace (isolate deployments on one Redis)      |
| `AI_REALTIME_HEARTBEAT_MS` / `AI_REALTIME_MAX_STREAM_LIFETIME_MS`     | keepalive interval / hard stream-lifetime cap             |
| `AI_REALTIME_MAX_PER_USER` / `AI_REALTIME_MAX_CONNECTIONS`            | per-user (429) / global (503) SSE caps                    |
| `AI_REALTIME_QUEUE_DEPTH`                                             | per-connection write buffer before a slow consumer is cut |
| `AI_REALTIME_PUBLISH_TIMEOUT_MS` / `AI_REALTIME_MAX_INFLIGHT_PUBLISH` | best-effort publish bounds                                |

Content-free run metrics: `amcore_ai_run_realtime_connections`, `amcore_ai_run_realtime_publish_total`,
`amcore_ai_run_realtime_events_total` (see [`docs/operations/observability.md`](../operations/observability.md)).

## Guardrails: prompt-injection containment (shipped — Arc D)

Arc D adds the reusable guardrail baseline the worker applies around **every** run. It follows
OWASP LLM01 defense-in-depth: the **primary** control is structural, backed by deterministic
low-false-positive guards and a safe refusal. It is **mitigated and contained, never eliminated** —
and it is the primitive the tool (Arc E) and multimodal (Arc G) arcs reuse to mark tool results and
files as untrusted.

- **Structural trust boundary (primary).** The worker never concatenates user text into the
  instruction channel. It puts a code-owned trusted instruction in `system` and wraps the untrusted
  user turn as a **JSON-encoded, salted `<amcore:user-data-{nonce}>` container**, escaping every
  `<`/`>`/`&` so a forged closing marker can never appear as a literal token. The nonce is
  collision-hardening / a leak canary, **not** a secret. The shape is provider-agnostic (`system` +
  `messages`) — no provider-specific blocks.
- **Input guard (deterministic, low-FP).** Scans the untrusted text → `allow | flag | block`.
  Gated by `AI_GUARDRAIL_INPUT_MODE`: `off` disables it; `flag` (default) records/counts findings but
  never blocks; `block` hard-blocks **only** an attack on AMCore's own envelope/markers. Generic
  jailbreak / "ignore previous instructions" phrasing only **flags** — a prompt that merely discusses
  or quotes an injection technique is never hard-blocked.
- **Output guard (always on).** Runs on the complete model output **before persistence**; a boundary/
  preamble-marker leak or a self-disclosure of hidden instructions is **discarded** (never persisted)
  and the run refuses.
- **Oversize (always on).** Input past `AI_GUARDRAIL_MAX_INPUT_CHARS` is refused
  (`guardrail_input_too_large`), independent of the input mode.
- **Safe refusal.** A guardrail block is a **terminal, non-retryable `FAILED`** run with a bounded
  `terminalReasonCode` (`guardrail_input_blocked` / `guardrail_output_blocked` /
  `guardrail_input_too_large`) surfaced by `GET /ai/runs/:id`, plus a fixed canned assistant-visible
  refusal turn (`role=ASSISTANT`, author `SYSTEM`, redaction-classified — so it is attributably not a
  model generation) and content-free `GUARDRAIL_CHECK`/`OUTPUT_VALIDATION`/`REFUSAL` steps.
- **Adversarial corpus gate.** A small, in-repo, license-clean corpus (attack + benign + multilingual)
  drives the guards as a **regression signal, not a proof of completeness or a security guarantee**.
  It is not a vendored external dataset.
- **Content-free telemetry.** No prompt/output content or boundary marker is ever logged, stored, or
  put in a metric label. Step detail records only **bounded category codes + counts** (defensively
  sanitized to a strict grammar at the DB write boundary), and the counter
  `amcore_ai_guardrail_checks_total{stage,verdict,role}` carries only bounded labels — a category
  value is never a metric label.

**Not claimed:** model-level jailbreak robustness (that is the provider's alignment), and indirect
injection via tools/files (addressed by Arcs E/G, which reuse this boundary).

### Configuration (Arc D)

| Env var                        | Purpose                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `AI_GUARDRAIL_INPUT_MODE`      | input-guard mode: `off` \| `flag` (default) \| `block`                           |
| `AI_GUARDRAIL_MAX_INPUT_CHARS` | max characters of untrusted user text before a run is refused (default `100000`) |

## Tool Loop + Human-in-the-Loop Approvals (shipped — Arc E)

Arc E turns the Arc C single-shot executor into a **bounded, durable, worker-executed agent loop** over
**code-owned tools**, and gates SENSITIVE/DESTRUCTIVE tool calls behind a **durable human approval**. No
product tools ship — this is the reusable engine plus one SAFE reference tool (`current_time`).

**The SDK never executes tools.** The gateway only returns the model's requested tool call; a tool runs
**only** host-side in the worker, after its `AiToolInvocation` is persisted. The web role can neither
resolve the tool registry/loop/dispatcher nor run an approved tool (enforced by DI + a process-role gate).

### Code-owned tool registry (worker-only)

- An `AiTool` is `{ toolId, displayName, description, Zod parameters, riskClass, idempotency, execute }`.
  The model may only invoke a **registered** tool that is **also** on the conversation assistant's
  `toolAllowlist` — it cannot invent one. The **default allowlist is empty**: a fresh starter is never
  autonomously tool-capable; tools are opt-in via an assistant binding (Arc F) or a fork's registration.
- `riskClass` (`SAFE` | `SENSITIVE` | `DESTRUCTIVE`) drives the **code-owned** approval policy (never
  model/catalog-supplied): only `SAFE` runs without a human approval. A tool must declare a retry-safe
  `idempotency` (`read_only` | `idempotent`); a non-retry-safe (`unsafe`) tool is refused registration.

### Bounded loop (worker) — at most one tool call per provider step

```
per step: reconstruct transcript → generateText (tools offered) → output guard →
  0 calls                  → finalize COMPLETED (assistant text)
  1 SAFE call              → execute host-side → append tool result → next step
  1 non-SAFE call          → PARK for approval (below)
  > 1 call                 → FAILED  too_many_tool_calls
  unknown / not-allowlisted → FAILED tool_not_allowed
  step bound reached       → FAILED  tool_loop_exhausted
```

The step bound is the **provider-call** count (`AI_TOOL_LOOP_MAX_STEPS`, default 8); the whole loop is
also capped by the run's deadline, and the lease is renewed each step. Each provider call commits its own
`PROVIDER_CALL` step + a run-attributed `AiUsageLedger` row. A tool result **re-enters the model as
untrusted data** through the **same** Arc D salted boundary (indirect-injection containment); the output
guard runs **every step** over the user marker **and** the tool-result marker — mitigated, never
eliminated. Crash-safe resume reconstructs from Postgres and never re-runs an already-applied invocation.

### Human-in-the-loop approvals

A non-SAFE call **parks** the run: one transaction records the provider call + `AiApproval(PENDING)` +
`AiToolInvocation(AWAITING_APPROVAL)` and CASes the run `RUNNING → WAITING_APPROVAL`, **releasing the
lease** (the run is unleased and non-due, so the reaper and the claim query ignore it). The **owner**
decides; on approve/reject the run re-queues (`WAITING_APPROVAL → QUEUED`, **without** consuming a retry
attempt), and the resumed worker executes the approved tool (its `APPROVED → EXECUTING` CAS is the sole
gate that lets a non-SAFE tool run) or feeds a fixed, content-free rejection notice.

```
RUNNING ─(non-SAFE call)─▶ WAITING_APPROVAL ─approve─▶ QUEUED → resume: execute approved tool → COMPLETED
                                            ─reject──▶ QUEUED → resume: feed rejection, answer without it
                                            ─approval TTL elapsed (cron)──▶ FAILED  approval_expired
                                            ─run deadline passed (cron)───▶ EXPIRED deadline_exceeded
                                            ─cancel-while-waiting─────────▶ CANCELLED (approval voided)
```

- **Approval states:** `PENDING → APPROVED | REJECTED | EXPIRED`. v1 approver = the conversation **owner
  only** (operator approval → Arc F). A repeat of the same decision is idempotent; a conflicting one is
  `409`; a **stale** approval (TTL/deadline already elapsed) is inline-expired to `409` — never re-queued.
- **Expiry** is a worker-only `@Cron` sweep (`FOR UPDATE SKIP LOCKED`, DB-owned, not Redis-locked) that
  shares the decision path's expiry state machine: the run's own deadline → `EXPIRED` (`deadline_exceeded`),
  the approval TTL only → `FAILED` (`approval_expired`).

### HTTP surface (bearer, owner-scoped)

| Method + path                     | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `GET /ai/approvals`               | List owned approvals (`?status=pending\|approved\|rejected\|expired`). |
| `POST /ai/approvals/:id/decision` | Approve or reject an owned pending approval (`{ decision, reason? }`). |

`GET /ai/runs/:id` gains a `pendingApprovalId` hint on a `waiting_approval` run. Missing/not-owned →
`404`; a stale/raced/conflicting decision → `409` (an already-recorded **same** decision → idempotent `200`).

### Audit + metrics (content-free)

The approval lifecycle is written **in the same transaction** as its state change (security evidence, not
telemetry): `ai.approval.requested` (park), `ai.approval.approved` / `ai.approval.rejected` (decision),
`ai.approval.expired` (expiry or cancel-void); tool execution is `ai.tool.invoked` /
`ai.tool.execution_failed` (best-effort). Targets: `AI_TOOL_INVOCATION`, `AI_APPROVAL`. Metadata is
allowlisted — `toolId, riskClass, invocationId, approvalId, runId, decision, reasonCode, outcome` —
**never** args, results, prompts, or reason text. Metrics: `amcore_ai_tool_invocations_total{tool_id,
risk_class,outcome}` (`tool_id` bounded to the code-owned registry), `amcore_ai_approvals_total{kind,state}`,
and the `amcore_ai_tool_loop_steps` histogram — bounded labels only.

### Process-role split (ADR-041)

- **Worker-only:** the tool registry (`AI_TOOLS` + `AiToolRegistry`), the loop executor + host-side tool
  dispatcher, the approval parker, and the approval-expiry `@Cron`.
- **Web:** the approval HTTP surface (`AiApprovalsController` + `AiApprovalService`) and cancel-while-
  waiting — Postgres read/write + a best-effort wake, no provider or tool I/O.

### Configuration (Arc E)

| Env var                        | Purpose                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_TOOL_LOOP_MAX_STEPS`       | max provider steps per run before `tool_loop_exhausted` (default `8`, bounded)                                                        |
| `AI_TOOL_EXECUTION_TIMEOUT_MS` | per-tool host-side execution bound in ms (default `15000`)                                                                            |
| `AI_APPROVAL_TTL_MS`           | how long a run may sit parked in `waiting_approval` before its approval expires (default 24h; the run's own deadline wins if tighter) |

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

| Arc | Adds _(later arc)_                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------- |
| F   | Assistant registry admin contract + human takeover / operator review (transcript, take/release control). |
| G   | Multimodal foundation: storage-backed file/image/PDF artifacts with capability-gated routing.            |

## See Also

- Backend architecture & conventions — [`docs/backend/architecture-and-conventions.md`](../backend/architecture-and-conventions.md)
- Notification durability pattern the run worker reuses — [`docs/notifications/README.md`](../notifications/README.md)
- Shared schemas — [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/)
