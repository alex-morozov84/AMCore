# AI Capability Layer

AMCore ships a reusable, provider-agnostic AI backend foundation: conversations,
durable runs, model routing, assistant configs, guardrails, code-owned tools with
human approval, human takeover, multimodal image/PDF inputs, usage accounting,
audit, and metrics.

It is the engine for AI assistants, not an applied product bot. Product forks
bring their own domain-specific assistants, prompts, tools, and UI.

## What Is Included

| Area                  | Built-in behavior                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Providers / models    | Seeded DB catalog for mock, Anthropic, OpenAI, OpenRouter, OpenAI-compatible, and Yandex AI Studio. Secrets stay in env vars.          |
| Conversations / runs  | Owner-scoped conversations, idempotent run creation, durable Postgres-owned state machine, worker recovery, cancel, status fetch/list. |
| Realtime              | Status-only SSE hints for run status changes. Clients refetch durable state from HTTP; this is not token streaming.                    |
| Assistants / agents   | SUPER_ADMIN assistant registry: create, publish immutable versions, enable/disable, bind enabled assistants to conversations.          |
| Tools / approvals     | Code-owned worker-only tools, assistant allowlists, SAFE auto-execution, SENSITIVE/DESTRUCTIVE human approval.                         |
| Human takeover        | Owner or cross-user SUPER_ADMIN takeover/release, transcript read, operator turns, stale bot-write fence.                              |
| Multimodal artifacts  | Private JPEG/PNG/WebP/PDF upload, `artifact_ref` run input, capability-gated routing, app-mediated download.                           |
| Guardrails / security | Trusted/untrusted boundary, text input/output guards, content-free audit/log/metrics posture, explicit residual risks.                 |

## Quick Start

Run migrations and seed the AI catalog:

```bash
pnpm --filter api db:seed
```

For local development with no provider key, the key-less `mock` provider works
out of the box. For the seeded Claude default, set:

```env
ANTHROPIC_API_KEY=<your-key>
```

Then restart the API/worker.

Minimal text run:

```bash
CONV_ID=$(
  curl -s -X POST /ai/conversations \
    -H 'Authorization: Bearer <user-jwt>' \
    -H 'Content-Type: application/json' \
    -d '{"title":"Support question"}' | jq -r '.id'
)

RUN_ID=$(
  curl -s -X POST /ai/runs \
    -H 'Authorization: Bearer <user-jwt>' \
    -H 'Content-Type: application/json' \
    --data-binary @- <<JSON | jq -r '.id'
{
  "conversationId": "$CONV_ID",
  "inputParts": [{ "type": "text", "text": "Summarize my options." }],
  "idempotencyKey": "demo-001"
}
JSON
)

curl /ai/runs/$RUN_ID -H 'Authorization: Bearer <user-jwt>'
curl /ai/conversations/$CONV_ID/messages -H 'Authorization: Bearer <user-jwt>'
```

Minimal multimodal run:

```bash
ARTIFACT_ID=$(
  curl -s -X POST /ai/conversations/$CONV_ID/artifacts \
    -H 'Authorization: Bearer <user-jwt>' \
    -F 'file=@./diagram.png;type=image/png' | jq -r '.id'
)

curl -X POST /ai/runs \
  -H 'Authorization: Bearer <user-jwt>' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<JSON
{
  "conversationId": "$CONV_ID",
  "inputParts": [
    { "type": "text", "text": "What is shown here?" },
    { "type": "artifact_ref", "artifactId": "$ARTIFACT_ID" }
  ],
  "idempotencyKey": "demo-002"
}
JSON
```

These examples assume the API is mounted at the shown paths and that `jq` is
available locally. In a real client, use the generated OpenAPI contract or the
shared Zod schemas rather than string-building JSON.

## Normal Product Flow

1. Optional: a SUPER_ADMIN creates and enables an assistant version.
2. A user creates a conversation, optionally bound to that assistant.
3. The user queues a run with structured `inputParts`.
4. The worker executes the run and writes the assistant turn durably.
5. Clients poll or subscribe to the status-only SSE hint, then refetch durable state.
6. If a non-SAFE tool is requested, the run parks for owner approval.
7. If a human takes over, stale bot writes are fenced off.

## HTTP API

All user-facing endpoints are bearer-authenticated. Missing or not-owned
resources generally return no-leak `404`; cross-user support access is explicit.

| Method + path                                     | Who                       | Purpose                                                                                             |
| ------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `POST /ai/conversations`                          | User                      | Create an owner-scoped conversation; optional `assistantId` binds an enabled assistant version.     |
| `GET /ai/conversations/:id`                       | Owner                     | Fetch one owned conversation.                                                                       |
| `POST /ai/runs`                                   | Owner                     | Queue an idempotent run with structured `inputParts`.                                               |
| `GET /ai/runs/:id`                                | Owner                     | Fetch current run status and `pendingApprovalId` when parked on approval.                           |
| `GET /ai/runs`                                    | Owner                     | Keyset-paginated run list, optionally filtered by `conversationId`.                                 |
| `POST /ai/runs/:id/cancel`                        | Owner                     | Cooperatively cancel a queued/running/waiting run.                                                  |
| `GET /ai/runs/:id/stream`                         | Owner                     | Status-only SSE hint stream; no token/content streaming.                                            |
| `GET /ai/approvals`                               | Owner                     | List owned approvals, filterable by status.                                                         |
| `POST /ai/approvals/:id/decision`                 | Owner                     | Approve/reject a pending tool approval.                                                             |
| `POST /ai/conversations/:id/takeover`             | Owner or cross-user admin | Human takeover; cross-user SUPER_ADMIN requires fresh auth + reason.                                |
| `POST /ai/conversations/:id/release`              | Owner or cross-user admin | Release human control back to bot.                                                                  |
| `GET /ai/conversations/:id/messages`              | Owner or cross-user admin | Transcript read; cross-user SUPER_ADMIN requires fresh auth + `x-amcore-operator-reason`.           |
| `POST /ai/conversations/:id/messages`             | Current human holder      | Post a text-only human/operator turn while holding control.                                         |
| `POST /ai/conversations/:id/artifacts`            | Owner                     | Upload private JPEG/PNG/WebP/PDF artifact for later run input.                                      |
| `GET /ai/conversations/:id/artifacts/:artifactId` | Owner or cross-user admin | App-mediated artifact download; cross-user SUPER_ADMIN requires fresh auth + reason + strict audit. |
| `GET /admin/ai/assistants`                        | SUPER_ADMIN               | List assistant versions (`version=latest                                                            | all`, optional `slug`). |
| `GET /admin/ai/assistants/:id`                    | SUPER_ADMIN               | Fetch one assistant version.                                                                        |
| `POST /admin/ai/assistants`                       | SUPER_ADMIN + fresh auth  | Create assistant slug/version 1.                                                                    |
| `POST /admin/ai/assistants/:slug/versions`        | SUPER_ADMIN + fresh auth  | Publish a new immutable assistant version.                                                          |
| `PATCH /admin/ai/assistants/:id`                  | SUPER_ADMIN + fresh auth  | Toggle `enabled` and/or rename `displayName`; behavioral config is immutable.                       |

API keys are intentionally rejected from privileged assistant/operator surfaces;
use bearer sessions.

## Guides

- [Assistants](./assistants.md) — create/version/enable agents and bind them to conversations.
- [Runs](./runs.md) — conversations, run lifecycle, idempotency, cancellation, and status-only SSE.
- [Artifacts](./artifacts.md) — private upload/download and multimodal `artifact_ref` inputs.
- [Tools and approvals](./tools-and-approvals.md) — register tools and handle human approval.
- [Operators](./operators.md) — human takeover, transcript review, operator turns, and support access.
- [Providers](./providers.md) — seeded catalog, credentials, adding providers/models.
- [Security](./security.md) — trust boundary, guardrails, audit/log/metrics, residual risks.

## Current Scope and Deferred Work

Shipped: foundational Track C arcs A–G — persistence/contracts, gateway/catalog
runtime, durable runs, guardrails, tools/approvals, assistant registry/human
takeover, and multimodal image/PDF artifacts.

Deferred, additive follow-ons:

- provider/model/policy catalog admin HTTP surface and admin UI;
- operator role / assignment / org-shared support inbox;
- bot-initiated handoff and realtime control console;
- per-assistant guardrail policy;
- image generation and generic non-image/PDF file artifacts;
- provider Files API, artifact retention/GC, RAG/vector DB/embeddings;
- OCR, malware scanning, DLP/moderation, and visual prompt-injection scanning.

Until provider/model/policy admin ships, customize the model catalog through seed
data or explicit migrations/data migrations. Assistant/agent management is already
available through the assistant registry API.

## See Also

- Backend architecture & conventions — [`docs/backend/architecture-and-conventions.md`](../backend/architecture-and-conventions.md)
- Notification durability pattern reused by AI runs — [`docs/notifications/README.md`](../notifications/README.md)
- Observability metrics catalog — [`docs/operations/observability.md`](../operations/observability.md)
- Shared schemas — [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/)
