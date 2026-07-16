# AI Capability Layer

AMCore ships a reusable, provider-agnostic AI backend foundation: conversations,
durable runs, model routing, assistant configs, guardrails, code-owned tools with
human approval, human takeover, multimodal image/PDF inputs, usage accounting,
audit, and metrics.

It is the **engine** for AI assistants, not an applied product bot. Product forks
bring their own domain-specific assistants, prompts, tools, and UI on top of it.
Reach for this layer when a feature needs an LLM turn that must be durable,
owner-scoped, preference/approval-governed, and auditable — not a one-off
fire-and-forget provider call.

Endpoint shapes (paths, bodies, status codes) live in the Swagger/OpenAPI
document at `/docs` in development — the source of truth. This guide covers the
model, the extension points, and the invariants OpenAPI does not express.

## What it provides

- **Conversations & runs** — owner-scoped durable transcripts; a run is one user
  turn plus its worker execution. Run creation is idempotent; state lives in
  Postgres, not the worker. See [Runs](./runs.md).
- **Worker-owned execution** — the web role never calls a provider. A worker
  resolves a frozen model snapshot, calls the `ModelGateway`, retries, recovers
  leases, and writes the transcript and usage ledger durably.
- **Status-only realtime** — an SSE stream of run-status hints, never token or
  content streaming; clients refetch durable state over HTTP.
- **Assistants** — a SUPER_ADMIN registry of versioned, **immutable** assistant
  configs (prompt, model, modalities, tool allowlist). See [Assistants](./assistants.md).
- **Providers & models** — a seeded, capability-gated DB catalog; secrets stay in
  env vars. See [Providers](./providers.md).
- **Tools & approvals** — code-owned worker-side tools; `SAFE` auto-runs,
  `SENSITIVE`/`DESTRUCTIVE` park for owner approval. See [Tools and approvals](./tools-and-approvals.md).
- **Human takeover & operator review** — owner or cross-user SUPER_ADMIN takeover
  with a stale-bot-write fence. See [Operators](./operators.md).
- **Multimodal artifacts** — private JPEG/PNG/WebP/PDF uploads referenced by id,
  capability-gated, app-mediated download. See [Artifacts](./artifacts.md).
- **Security posture** — trust boundary, guardrails, content-free audit/log/metrics,
  explicit residual risks. See [Security](./security.md).

## Quick start

Seed the AI catalog:

```bash
pnpm --filter api db:seed
```

The key-less `mock` provider works out of the box for local development. For the
seeded Claude default, set `ANTHROPIC_API_KEY=<your-key>` and restart the
API/worker.

A minimal text run — create a conversation, queue a run, then refetch durable
state (this is not token streaming; poll `GET /ai/runs/:id` or subscribe to the
status-only stream, then refetch):

```bash
CONV_ID=$(curl -s -X POST /ai/conversations \
  -H 'Authorization: Bearer <user-jwt>' -H 'Content-Type: application/json' \
  -d '{"title":"Support question"}' | jq -r '.id')

RUN_ID=$(curl -s -X POST /ai/runs \
  -H 'Authorization: Bearer <user-jwt>' -H 'Content-Type: application/json' \
  -d "{\"conversationId\":\"$CONV_ID\",\"inputParts\":[{\"type\":\"text\",\"text\":\"Summarize my options.\"}],\"idempotencyKey\":\"demo-001\"}" \
  | jq -r '.id')

curl /ai/runs/$RUN_ID -H 'Authorization: Bearer <user-jwt>'
curl /ai/conversations/$CONV_ID/messages -H 'Authorization: Bearer <user-jwt>'
```

In a real client, generate from the OpenAPI contract or use the shared Zod
schemas rather than string-building JSON. Multimodal input (`artifact_ref`) is in
[Artifacts](./artifacts.md).

## Normal product flow

1. Optional: a SUPER_ADMIN creates and enables an assistant version.
2. A user creates a conversation, optionally bound to that assistant.
3. The user queues a run with structured `inputParts`.
4. The worker executes the run and writes the assistant turn durably.
5. Clients subscribe to the status-only SSE hint (or poll), then refetch state.
6. If a non-`SAFE` tool is requested, the run parks for owner approval.
7. If a human takes over, stale bot writes are fenced off.

## HTTP surface

All user-facing endpoints are bearer-authenticated and owner-scoped; missing or
not-owned resources return no-leak `404`. Cross-user support access is explicit,
requires fresh auth and a bounded reason, and is fail-closed audited. Privileged
assistant/operator surfaces **reject API keys** — use bearer sessions. See `/docs`
for exact shapes; each guide documents the semantics that matter.

## Current scope & deferred work

Shipped: persistence/contracts, gateway/catalog runtime, durable runs, guardrails,
tools/approvals, assistant registry, human takeover, and multimodal image/PDF
artifacts.

Deferred, additive follow-ons: provider/model/policy admin HTTP surface and UI;
operator role/assignment/org-shared support inbox; bot-initiated handoff and a
realtime control console; per-assistant guardrail policy; image generation and
non-image/PDF file artifacts; provider Files API, artifact retention/GC, and
RAG/embeddings; OCR, malware scanning, DLP/moderation, and visual
prompt-injection scanning.

Until provider/model/policy admin ships, customize the model catalog through seed
data or explicit migrations. Assistant management is already available via the
assistant registry API.

## See also

- [Backend architecture & conventions](../backend/architecture-and-conventions.md)
- [Notifications](../notifications/README.md) — the durable-run pattern reused here.
- [Observability](../operations/observability.md) — the AI metrics catalog.
- Shared schemas — [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/)
