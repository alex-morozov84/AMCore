# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- AI capability layer — multimodal foundation (Track C, Arc G). Storage-backed **image (JPEG/PNG/WebP)
  and PDF** artifacts with capability-gated routing. **Upload** (`POST /ai/conversations/:id/artifacts`,
  bearer, owner-only, throttled): magic-byte validated (never the client `Content-Type`; no GIF/SVG),
  stored **private** (never a public/signed URL), recorded as an `UNTRUSTED` `AiArtifact`. **Run input**
  references artifacts by id (`artifact_ref` content parts); at run creation the producer validates each —
  conversation scope (no-leak `400`), the frozen model's capability (`vision`/`pdf`), the bound assistant's
  `allowedModalities`, a per-message count + raw-byte budget, and a **rebind matrix** (an artifact may be
  reused only after its bound run is `FAILED`/`CANCELLED`/`EXPIRED`; `409` on
  `QUEUED`/`RUNNING`/`WAITING_APPROVAL`/`WAITING_HUMAN`/`COMPLETED`) — all in the run-creation transaction.
  The **worker** fetches bytes server-side and inlines them into a multimodal provider request as sibling
  parts inside the **same Arc D untrusted user-turn container** (never `system`); the system instruction
  gains a multimodal untrusted-data policy (defense in depth). **Download**
  (`GET /ai/conversations/:id/artifacts/:artifactId`, app-mediated, attachment + `nosniff`, no Range) is
  owner-or-cross-user-operator, matching the Arc F transcript posture (step-up + bounded reason for a
  cross-user operator), with a content-free **fail-closed** `ai.conversation.artifact_accessed` audit
  before bytes are served. A new strict audit path (`record({ failOpen: false })`) also **retroactively
  hardens the Arc F transcript read**, which previously used the fail-open path. Operator/owner human
  turns are restricted to text (`artifact_ref` rejected). New env: `AI_ARTIFACT_MAX_IMAGE_BYTES`,
  `AI_ARTIFACT_MAX_DOCUMENT_BYTES`, `AI_ARTIFACT_MAX_PARTS_PER_MESSAGE`. Guardrails scan text only — text
  rendered inside an image/PDF is **not** scanned (a documented OWASP LLM01 residual; contained by channel
  separation, never claimed eliminated). No new migration (the Arc A `AiArtifact` schema was laid whole).
- AI capability layer — assistant registry admin + runtime application + human takeover / operator review
  (Track C, Arc F). **Assistant registry admin** (`admin/ai/assistants`, SUPER_ADMIN, bearer-only):
  create / publish an **immutable** version / in-place `enabled`+`displayName` patch (mutations are
  step-up + audited), plus role-gated list (latest-per-slug) / get. **Runtime application** of the bound
  assistant: the `enabled` kill-switch gates binding (`400`), run creation (producer `409`), and execution
  (terminal `assistant_disabled`); the
  `systemPrompt` becomes the trusted `system` instruction (the code-owned structural boundary policy is
  always appended — the Arc D boundary is never weakened); `modelSelection` freezes the run model
  credential-gated across `[modelSlug, ...fallback]`, and a pinned uncredentialed model fails run creation
  `503 model_not_configured` (never a silent `mock` downgrade); `toolAllowlist` is unchanged from Arc E.
  **Ownership fence activated (ADR-049):** each run freezes the conversation's `ownershipGeneration`; a
  human takeover increments it, and the worker refuses to write once it moves — at preflight, a loop-top
  early exit, and an authoritative in-tx fence on every durable write — terminalizing
  `cancelled`/`superseded_by_human` with no stale transcript/step/terminal row. **Takeover / release /
  transcript / operator-message** (bearer; owner or cross-user SUPER_ADMIN operator; API keys `401`;
  not-visible `404`): take control also supersedes unleased bot runs + voids their pending approvals under
  the shared approval-driven lock (a later decision is a `409` non-effect); an operator turn requires
  currently holding control (`409` else) and is a `role=ASSISTANT` message authored `OPERATOR`
  (cross-user) / `USER` (owner). The **owner may always reclaim/release their own conversation**; a
  different SUPER_ADMIN on a held conversation gets `409`. A **cross-user operator** needs step-up
  freshness (`403 STEP_UP_REQUIRED`) **and** a bounded reason/ticket ref on every action incl. the
  transcript read (via the `x-amcore-operator-reason` header, not a query param). **Privacy posture
  (accepted):** a SUPER_ADMIN can read a user's private AI transcript cross-user — gated by step-up + a
  mandatory reason and **audited** (`ai.conversation.transcript_accessed`, fail-closed before serving);
  owner reads are not audited. **Content-free everywhere:** message/prompt/reason text never enters
  audit/logs/metrics — audits (`ai.conversation.taken_over`/`released`/`operator_message`/
  `transcript_accessed`, `ai.assistant.*`, per-approval `ai.approval.expired`) carry only bounded
  ids/codes; the operator reason (body + header) and message `content` are redacted in the Pino serializer
  **and** the source-side `sanitizeHeaders()`; metrics
  (`amcore_ai_conversation_control_total{action,actor_role,role}`, `amcore_ai_assistant_admin_total{action,role}`)
  carry only bounded labels. New audit targets `AI_ASSISTANT`/`AI_CONVERSATION`; no new env var (cross-user
  step-up reuses `STEP_UP_MAX_AGE_SECONDS`). No product bot ships; process-role split keeps the whole
  surface web-only (worker owns only the fence).
- AI capability layer — self-hosted tool loop + human-in-the-loop approvals (Track C, Arc E). Turns the
  Arc C single-shot executor into a **bounded, durable, worker-executed agent loop** over **code-owned
  tools**, gating SENSITIVE/DESTRUCTIVE calls behind a **durable human approval**. No product tools ship
  — only the reusable engine + one SAFE reference tool (`current_time`); the default assistant tool
  allowlist is empty, so a fresh starter is never autonomously tool-capable. **The SDK never executes
  tools** — the gateway only returns the model's requested call; a tool runs **only** host-side in the
  worker after its `AiToolInvocation` is persisted. **Process roles (ADR-041):** the tool registry, the
  loop executor + host-side dispatcher, the approval parker, and the approval-expiry `@Cron` are
  **worker-only**; the approval HTTP surface + cancel-while-waiting are **web-only** — neither leaks into
  the other DI graph (process-role e2e gate). The loop offers only tools that are BOTH registered AND on
  the conversation assistant's `toolAllowlist`, allows **at most one tool call per provider step** (0 →
  `COMPLETED`; 1 SAFE → execute host-side + continue; 1 non-SAFE → park; `>1` → `too_many_tool_calls`;
  unknown/not-allowlisted → `tool_not_allowed`), is bounded by `AI_TOOL_LOOP_MAX_STEPS` provider steps
  (`tool_loop_exhausted`) + the run deadline + a per-step lease renewal, and ledgers **one
  `AiUsageLedger` row per provider call**. Each tool result **re-enters the model as untrusted data**
  through the same Arc D salted boundary and the output guard runs every step over the user **and**
  tool-result markers (indirect injection mitigated, never eliminated); crash-safe resume reconstructs
  from Postgres and never re-runs an applied invocation. A non-SAFE call **parks** the run
  (`RUNNING → WAITING_APPROVAL`, lease released) with `AiApproval(PENDING)` +
  `AiToolInvocation(AWAITING_APPROVAL)`; the **owner** approves/rejects, the run re-queues without
  consuming a retry attempt, and the resumed worker executes the approved tool (its `APPROVED →
EXECUTING` CAS is the sole gate for a non-SAFE tool) or feeds a fixed rejection notice. A worker-only `@Cron` sweep expires overdue approvals
  (`FOR UPDATE SKIP LOCKED`, DB-owned): the run's own deadline → `EXPIRED` (`deadline_exceeded`), the
  approval TTL only → `FAILED` (`approval_expired`); cancel-while-waiting terminalizes the run
  `CANCELLED` and voids the gate. Endpoints (bearer, owner-scoped, 404 on not-owned): `GET /ai/approvals`
  (`?status=`), `POST /ai/approvals/:id/decision` (`{ decision, reason? }`; idempotent same-decision
  `200`, conflicting/stale `409`); `GET /ai/runs/:id` gains a `pendingApprovalId` hint. Content-free
  audit: the **approval lifecycle** (`ai.approval.requested`/`approved`/`rejected`/`expired`) is written
  **in the same transaction** as its state-change CAS (security evidence — a committed decision/park/
  expiry can never lack its row); **tool-execution** audit (`ai.tool.invoked`/`execution_failed`) is
  best-effort. Targets `AI_TOOL_INVOCATION`/`AI_APPROVAL`; allowlisted metadata only — never
  args/results/prompts/reason text. Plus bounded metrics
  (`amcore_ai_tool_invocations_total{tool_id,risk_class,outcome}`, `amcore_ai_approvals_total{kind,state}`,
  `amcore_ai_tool_loop_steps`). New env: `AI_TOOL_LOOP_MAX_STEPS`, `AI_TOOL_EXECUTION_TIMEOUT_MS`,
  `AI_APPROVAL_TTL_MS`. See [`docs/ai/README.md`](docs/ai/README.md).
- AI capability layer — prompt-injection guardrail baseline (Track C, Arc D). Defense-in-depth
  containment per OWASP LLM01, applied by the worker around every run: a **structural trust boundary**
  (a code-owned trusted `system` instruction + the untrusted user turn JSON-encoded in a salted
  `<amcore:user-data-{nonce}>` container with `<`/`>`/`&` escaped, so a forged closing marker can
  never appear as a token; the nonce is collision-hardening, not a secret; provider-agnostic
  `system`+`messages` only), deterministic **low-false-positive input/output guards**, and a **safe
  refusal**. The input guard is gated by `AI_GUARDRAIL_INPUT_MODE` (`off` | `flag` default | `block`)
  and hard-blocks only an attack on AMCore's own envelope/markers — generic jailbreak phrasing merely
  flags, so a benign prompt that discusses/quotes injection is never blocked; the output guard (always
  on) discards a leaked/disclosing model output before persistence; oversized input
  (`AI_GUARDRAIL_MAX_INPUT_CHARS`) is refused. A guardrail block is a terminal, non-retryable `FAILED`
  run with a bounded `terminalReasonCode` (`guardrail_input_blocked` / `guardrail_output_blocked` /
  `guardrail_input_too_large`) plus a fixed canned refusal turn (`role=ASSISTANT`, author `SYSTEM`,
  redaction-classified) and content-free `GUARDRAIL_CHECK`/`OUTPUT_VALIDATION`/`REFUSAL` steps. A
  small, in-repo, license-clean adversarial corpus drives the guards as a **regression signal, not a
  security guarantee** — prompt injection is mitigated and contained, never eliminated; indirect
  injection via tools/files is deferred to later arcs that reuse this boundary. Content-free telemetry
  adds `amcore_ai_guardrail_checks_total{stage,verdict,role}` (no prompt/output/marker/category ever a
  label). New env: `AI_GUARDRAIL_INPUT_MODE`, `AI_GUARDRAIL_MAX_INPUT_CHARS`.
- AI capability layer — durable runs + run API (Track C, Arc C). Wires the `ModelGateway` into a
  worker-only durable run engine and a bearer-authenticated HTTP surface. **Process roles
  (ADR-041):** the **web** role creates/reads runs and hosts the SSE stream; the **worker** role is
  the only one that calls a provider — `ModelGateway`, the SDK adapters, the executor, the BullMQ
  processor, and the recovery cron are absent from the web DI graph (enforced by a process-role e2e
  gate). **Durability (ADR-052 pattern):** BullMQ is a wake hint; Postgres owns the run state
  machine, the 10-minute lease, the retry schedule (`maxAttempts` = 3, exponential backoff + jitter;
  the gateway `retryable` flag decides retry vs terminal, SDK retry stays disabled), and a
  per-replica recovery cron + expired-lease reaper (a lost wake is still drained). A claimed run
  runs one `generateText` call, then finalizes the assistant `AiMessage` + bounded `AiRunStep`s + a
  run-attributed `AiUsageLedger` row + the terminal-status CAS in **one transaction** — so the
  provider effect is **at-least-once** but the durable outcome is **exactly-once** (success is never
  faked without a durable transcript + ledger). Endpoints (bearer, owner-scoped by
  `conversation.ownerUserId`, 404 on not-owned): `POST /ai/conversations`, `GET
/ai/conversations/:id`, `POST /ai/runs` (idempotent on `(conversationId, idempotencyKey)`), `GET
/ai/runs/:id`, `GET /ai/runs` (keyset cursor, newest first), `POST /ai/runs/:id/cancel`
  (cooperative), and `GET /ai/runs/:id/stream` — a **status-only** SSE stream (ADR-053 primitives,
  AI-scoped copy) that emits content-free `{ eventId, runId, status, reason }` hints to **refetch**
  the run; **not token streaming**, at-most-once across replicas via Redis Pub/Sub, no sticky
  sessions. New env (all optional): `AI_REALTIME_NAMESPACE`, `AI_REALTIME_HEARTBEAT_MS`,
  `AI_REALTIME_MAX_PER_USER`, `AI_REALTIME_MAX_CONNECTIONS`, `AI_REALTIME_QUEUE_DEPTH`,
  `AI_REALTIME_MAX_STREAM_LIFETIME_MS`, `AI_REALTIME_PUBLISH_TIMEOUT_MS`,
  `AI_REALTIME_MAX_INFLIGHT_PUBLISH`. New content-free metrics: `amcore_ai_run_realtime_connections`,
  `amcore_ai_run_realtime_publish_total`, `amcore_ai_run_realtime_events_total`. See
  [`docs/ai/README.md`](docs/ai/README.md).

- AI capability layer — runtime gateway (Track C, Arc B). A provider-agnostic `ModelGateway`
  over the Vercel AI SDK backed by the DB-backed catalog registry. `generateText` runs
  non-streaming text over the resolved model — an explicit slug or the **credential-gated
  default** (the `isDefault` model when its provider has a key, else the key-less `mock`, so a
  fresh fork works out of the box). `generateObject` adds **capability-gated** structured output
  validated against a Zod schema (real `response_format: json_schema` for OpenAI-compatible
  providers). Ships a deterministic `mock` plus two SDK adapters: Anthropic, and one
  OpenAI-compatible adapter serving OpenAI, OpenRouter, Yandex AI Studio, and any compatible
  endpoint — **per-family base URL and auth are code-owned** (Yandex uses an `Api-Key` header) and
  a catalog `baseUrl` is honored only for the generic compatible type, so a tampered row cannot
  redirect a credential. A row's logical `credentialSlot` resolves to a fixed env key through a
  code-owned allowlist (never a raw `process.env` index). Provider failures normalize to a bounded
  machine-readable taxonomy with a `retryable` flag (the SDK's own retry is disabled — retry is
  Postgres-owned at the durable-run layer). Each successful generation appends an `AiUsageLedger`
  row and increments content-free metrics (`amcore_ai_generations_total`, `amcore_ai_tokens_total`);
  no prompt/response content, model slug, or credential is ever a metric label or log field. New
  env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `YANDEX_API_KEY`,
  `AI_OPENAI_COMPATIBLE_API_KEY`, `AI_REQUEST_TIMEOUT_MS`, `AI_CATALOG_CACHE_TTL_SECONDS` (all
  optional). The gateway is not yet exposed over HTTP — the run worker and run API arrive in a later
  arc. See [`docs/ai/README.md`](docs/ai/README.md).

- AI capability layer — foundation (Track C, Arc A). A provider-agnostic AI control plane
  on its own `ai` Postgres schema. This first arc ships **persistence and shared contracts
  only — no runtime provider call yet**. Persistence: a DB-backed, admin-manageable catalog
  (`AiProvider` / `AiModel` / `AiModelPolicy` / `AiAssistant`) where provider `type` is a
  closed enum but capabilities/modalities are open bounded strings, and a provider references
  a logical `credentialSlot` (resolved through a code-owned allowlist, never a raw env name —
  no secret is stored); durable `AiConversation` (with a monotonic takeover fence) /
  `AiMessage` transcript; `AiRun` (a Postgres-owned state machine with inert lease/retry
  columns reused from the notification durability pattern) / `AiRunStep`; `AiToolInvocation` /
  `AiApproval` for the self-hosted tool loop + human-in-the-loop; `AiArtifact` (multimodal,
  trust-tagged); and `AiUsageLedger` (an authoritative snapshot/no-FK accounting record that
  survives user/org/model deletion). Shared Zod contracts (`ai-common`, `ai-enums`,
  `ai-catalog`, `ai-assistants`, `ai-runs`) cover the catalog admin surface, the bounded
  capability map, a precision-safe decimal-string cost, lowercase wire enums, and the
  multimodal content-part contract. `db:seed` seeds the intended shape (enabled `mock` +
  Claude default + disabled OpenAI/OpenRouter/Yandex/OpenAI-compatible examples) so a fork
  sees it without live keys. The runtime gateway, durable run worker, guardrails, tool loop,
  and human takeover have since shipped in Arcs B–F; multimodal routing remains a later arc. See
  [`docs/ai/README.md`](docs/ai/README.md). Also fixes the Prisma 7 seed-client construction
  (driver adapter) so `db:seed` runs.

- Telegram notification channel (notifications Arc D). A third external channel
  alongside in-app and email. A bearer user issues a one-time deep link
  (`POST /notifications/telegram/link`), opens the bot and presses **Start**; an inbound
  webhook (`POST /webhooks/telegram`, authenticated by a constant-time
  `X-Telegram-Bot-Api-Secret-Token` header — a new verifier family on the ADR-044
  primitive) binds the chat to the account in one transaction with durable `update_id`
  dedupe (effect-once), a one-time hashed token consumed only on a fully successful bind,
  and never silently moving a chat owned by another account. `GET /notifications/telegram/
connection` reports status; `DELETE …/connection` unlinks (cancelling pending
  deliveries). Outbound delivery is drained by the existing worker-only dispatcher through
  a direct Bot API client (plain text, no `parse_mode`); an unlinked user is an observable
  `SKIPPED telegram_not_linked` (never a retry storm), a blocked/chat-not-found destination
  fences the connection, and a `429 retry_after` is honored as a retry **floor** (clamped
  to 24h, never the 15-min cap). Opt-in via config; `apps/web` stays a stub (the deep link
  is returned as a string). Deploy registers the webhook once with
  `node dist/cli/telegram-setup.js`. See
  [`docs/notifications/README.md`](docs/notifications/README.md),
  [`docs/operations/webhooks.md`](docs/operations/webhooks.md), and
  [`docs/operations/deployment.md`](docs/operations/deployment.md).

- Realtime in-app notification stream (notifications Arc C). A bearer-authenticated
  Server-Sent Events endpoint `GET /notifications/stream` pushes a content-free hint
  (`created` / `read` / `archived` / `unread_changed`) whenever the recipient's feed
  changes, so a client refreshes without polling — Postgres stays the source of truth
  and every event means "refetch". Cross-replica fan-out runs over an environment- and
  version-namespaced Redis Pub/Sub channel with one dedicated subscriber per web
  replica and **no sticky sessions**; delivery is at-most-once and a dropped hint is
  recovered by the next reconnect refetch. The endpoint is a manual bounded writer (not
  `@Sse`): admission is enforced before any bytes (per-user cap → 429, global
  per-process cap → 503), the stream closes at access-token expiry (bounded by a server
  cap), a slow consumer is disconnected on write-buffer overflow, and the access token
  is sent via the `Authorization` header (never the URL). Tunable via
  `NOTIFICATIONS_REALTIME_*` env vars — deployments sharing one Redis must set a distinct
  `NOTIFICATIONS_REALTIME_NAMESPACE`. No JS client ships (`apps/web` stays a stub); the
  documented client contract and proxy/HTTP-2 guidance are in
  [`docs/notifications/README.md`](docs/notifications/README.md) and
  [`docs/operations/deployment.md`](docs/operations/deployment.md).
- Durable external notification delivery (notifications Arc B). A worker-only
  dispatcher drains `PENDING` deliveries with a Postgres `FOR UPDATE SKIP LOCKED`
  claim, leases each attempt, and owns the retry schedule and immutable attempt
  history — BullMQ is only a one-attempt wake hint, and a recovery `@Cron` (on
  every replica, not singleton-locked) drains a delivery whose wake was lost or
  that came from `notifyTx`. Finalize is a `(id, leaseToken)` compare-and-set, so
  a stale lease holder can never overwrite newer state; an expired lease is
  reaped (`ABANDONED` attempt → reschedule or fail). Ships the **email channel**:
  a worker-only adapter over `EmailService.send()` with a stable provider
  idempotency key (`notification-delivery:<id>`) that never enqueues the email
  queue, sent to a **verified** account-email destination only (an unverified
  address yields a `SKIPPED` delivery, never a retried `PENDING`). Adds a daily
  worker-only retention sweep (archived −30d, read −90d, unread −180d, finished
  attempts −30d) that never deletes a notification with an active delivery.
  First production definition: `account.password_changed` (security; in-app +
  email, both mandatory).
- Reusable notifications subsystem (in-app surface). Own `notifications`
  Postgres schema with a canonical per-user `Notification`, per-target
  `NotificationDelivery`, and immutable `NotificationDeliveryAttempt`;
  in-app delivery is inserted `DELIVERED` in the same database transaction as
  the canonical row, so the feed never depends on a worker. Bearer-authenticated
  HTTP surface for the recipient-scoped feed (cursor `(createdAt DESC, id DESC)`,
  no `total`), unread count, mark-read / mark-all-read / archive (idempotent),
  capabilities, per-`(category, channel)` preferences, and the master toggle
  (`PATCH /notifications/settings`). Internal `NotificationsService.notify()`
  and transaction-aware `notifyTx(tx, …)` are the only ways to create a
  notification — there is no public create endpoint. Required namespaced
  idempotency key with a stored payload fingerprint: a same-key retry with a
  matching fingerprint replays the existing row, a mismatching fingerprint
  fails stably. Definitions are code-owned and declare payload schema +
  default / mandatory channels + content classification + a localized
  `renderInApp`; titles and bodies are rendered server-side from the structured
  payload in the recipient's current `User.locale` at feed read time. (Email
  delivery shipped in Arc B, realtime SSE fan-out in Arc C, and the Telegram
  channel in Arc D — all above; Web Push and the triggered follow-ons remain
  future work.)
  Fork-facing guide: [`docs/notifications/README.md`](docs/notifications/README.md).
- Backend Architecture & Conventions guide
  (`docs/backend/architecture-and-conventions.md`): the end-to-end recipe for
  adding a module — boundaries, shared Zod contracts, process-role composition,
  the external-state fencing pattern, and the required OpenAPI/process-role tests.
- Explicit request-body size limit of 100 000 bytes (decimal) for JSON and
  urlencoded bodies, applied globally — including raw-body webhook routes — and
  shared by the production and e2e bootstraps so the limit is identical in both.
  The limit is measured against the decoded body (after any `Content-Encoding`
  inflation), not the wire size. An oversized body is rejected before route
  guards run (so a webhook signature is never evaluated for a too-large payload)
  and surfaces as `413 Payload Too Large` with a stable `PAYLOAD_TOO_LARGE` error
  code instead of a generic 500. Signature verification is unaffected — the
  verifier hashes `req.rawBody`, the decoded body buffer; multipart uploads keep
  their own Multer limit.
- Every public endpoint now documents its success response body and status code
  in the OpenAPI spec (`/docs`). Responses are declared with `@ZodResponse`, which
  keeps the runtime serialization, the TypeScript return type, and the generated
  schema in sync from a single source; a generated-spec test fails if a new
  handler ships without a typed success response.
- User locale is now resolved at registration and editable afterwards. `POST
/auth/register` accepts an optional `locale` (`ru`/`en`) and, when it is
  omitted, negotiates the best supported language from the `Accept-Language`
  header before falling back to the default. New OAuth users are seeded the same
  way from the language negotiated when the login flow started (an existing
  user's stored preference is never overwritten).
- `PATCH /auth/me` (Bearer only) to update the current user's `name`, `locale`,
  and `timezone`. Only supplied fields change; `timezone` is validated as an IANA
  zone and an explicit stored `locale` always wins over `Accept-Language`
  thereafter.

### Changed

- The `account.password_changed` security alert now also delivers to Telegram for a
  linked user (Arc D), as an **optional, non-mandatory** default channel — generic
  plain-text, disableable in preferences, and a no-op (`SKIPPED`) for an unlinked user.
  In-app and email remain mandatory and unchanged.
- Password reset now marks the account email **verified** in the same
  transaction as the password update: a successful reset proves control of the
  account mailbox (the single-use token was delivered there and returned), per
  OWASP Forgot Password / NIST 800-63B. The reset token is also consumed
  atomically (a guarded conditional update), so two concurrent resets cannot both
  succeed on one single-use token. The password-changed confirmation is now
  emitted through the durable notifications subsystem (`account.password_changed`)
  instead of a one-off queued email; the standalone `PASSWORD_CHANGED` email
  template/path was retired (`welcome` is now the only queued email template).
- API production build no longer compiles test artifacts into `dist` (and thus
  the runtime image): `.swcrc` now excludes `*.spec.ts`, `*-spec.ts`, `__tests__`,
  and `__mocks__` (SWC ignores the `tsconfig.build.json` excludes). Removed the
  redundant `@types/uuid` (uuid v13 ships its own types).

### Fixed

- Concurrent avatar uploads/deletes for the same user no longer corrupt storage.
  A monotonic per-user generation (`User.avatarGeneration`) fences every avatar
  mutation: the publish/delete is a conditional update that only lands while the
  stored generation is older, and a mutation only sweeps versions strictly older
  than its own. So a request that lost the race can neither overwrite the newer
  `avatarUrl` nor delete the live version — previously one upload's cleanup could
  delete the version another upload just published, leaving `avatarUrl` pointing at
  deleted storage. A per-user Redis lock serializes the common case; under
  contention, a lost race, or a Redis outage the request fails closed with a
  retriable `503` (`AVATAR_LOCKED`).
- Sign in with Apple now works end-to-end on the web. Apple uses
  `response_mode=form_post` and POSTs the callback, but only a GET callback
  existed (the POST 404'd) and the `SameSite=Lax` binding cookie was never sent
  on Apple's cross-site POST. Added a `POST /auth/oauth/:provider/callback`
  sharing one handler with the GET path, a dedicated `SameSite=None; Secure`
  binding cookie scoped to the Apple callback path, and first-login display-name
  capture from Apple's `user` field. Other providers are unchanged.
- Corrected auth token-verification and password-reset entropy documentation,
  avatar storage/media/API architecture documentation, and stale version,
  SHA-256, and media module comments.
- Reconciled `docs/auth/email-auth.md` with runtime: registration returns
  `201 Created` (not `200`), `GET /auth/me` wraps the user in a `user` envelope,
  invalid reset/verify tokens return `401` (not `400`), and the response examples
  no longer show a non-returned `systemRole` field.

### Security

- Closed two code-scanning findings on the security tooling rather than the app.
  `yaml` is pinned to 2.8.3 on the 2.x line (CVE-2026-33532 stack-overflow DoS;
  `lint-staged` still resolved 2.8.2, dev-only). The production Docker **runner**
  stage no longer inherits Corepack/pnpm (`FROM node:22-slim` instead of `base`):
  the container only runs `node dist/main.js`, and the one-shot migration runs the
  Prisma binary from the self-contained bundle, so pnpm is never used at runtime.
  This removes Corepack's bundled `undici` (CVE-2026-12151) from the shipped image
  and trims its attack surface. Verified on the built image: no Corepack pnpm
  cache, no runnable pnpm, and no `undici` package present.
- Resolved the 2026-06-20 transitive-advisory batch via `pnpm-workspace.yaml`
  overrides, all within the parents' declared ranges: `multer` 2.2.0
  (`@nestjs/platform-express`), `form-data` 4.0.6 (`axios`), `hono` 4.12.25,
  `vite` 7.3.5, and the dev/build-only `undici` 7.28.0 (`testcontainers`),
  `piscina` 4.9.3 (`@swc/cli` / `@nestjs/cli`), `@babel/core` 7.29.6. `js-yaml`
  is pinned to 4.2.0 on the 4.x line only (GHSA-h67p-54hq-rp68); the dev-only 3.x
  consumer (`@istanbuljs/load-nyc-config`, coverage tooling) predates the 4.x API
  and parses only trusted project config.
- Bumped the `protobufjs` override to 7.6.3 and `tmp` to 0.2.7, closing three
  transitive advisories (two high, one medium). `protobufjs` stays on the 7.x
  line its parents require (`@nestjs/terminus` > `@grpc/grpc-js`, and the dev-only
  `testcontainers` > `dockerode`); `tmp` is dev-only via `testcontainers`.
- Resolved transitive dependency advisories (`protobufjs`, `tmp`, `fast-uri`,
  `rollup`, `lodash`, `brace-expansion`, `picomatch`) by materializing pnpm
  version overrides. The overrides were previously declared under
  `package.json` `pnpm.overrides`, which pnpm 11 silently ignores; they now live
  in `pnpm-workspace.yaml` and are reflected in the lockfile. `brace-expansion`
  is pinned per major line (v1/v5) so the patched v5 is not forced onto v1
  consumers.
- Upgraded `next` to 16.2.9 and `next-intl` to 4.13.0, closing the Next.js
  advisories (middleware/proxy bypass, SSRF, XSS, cache poisoning, DoS) and the
  `next-intl` open-redirect / prototype-pollution advisories.
- Bumped `uuid` to 13.0.2 and the `protobufjs` override to 7.5.8 (newer advisory
  than the previous 7.5.6 pin). Forced the dev-only `uuid@10` (testcontainers)
  to the patched 11.1.1.
- Patched remaining transitive advisories via overrides: `@grpc/grpc-js` 1.14.4,
  `hono` 4.12.21, `@hono/node-server` 1.19.13, `postcss` 8.5.14, `ws` 8.21.0,
  `ajv` 8.20.0, `qs` 6.15.2, `esbuild` 0.28.1; and upgraded `turbo` to 2.9.18.
  Overrides are scoped to the vulnerable major so safe coexisting majors are
  untouched.

## [0.1.0] - 2026-06-12

First tagged release and baseline for SemVer versioning. Captures the Track A
production-readiness work and the platform foundation built so far.

### Added

- **Storage Service:**
  - Cloud-agnostic `StorageService` facade with `StorageProvider` contract
  - Drivers: S3-compatible production provider, local filesystem dev provider, in-memory test provider
  - S3 compatibility for AWS S3, Cloudflare R2, DigitalOcean Spaces, Yandex Object Storage, and Backblaze B2
  - AWS SDK checksum mode `WHEN_REQUIRED` for non-AWS compatibility
  - Public URL and signed URL support with capability checks
  - Private-by-default uploads; `UploadResult` deliberately carries no guaranteed URL
  - Object-key guard: traversal, leading slash, backslash, control chars, empty keys, and overlong keys rejected
  - `deleteMany()` S3 chunking with aggregate partial-failure exception
  - `FileValidationPipe` with magic-byte validation and presets for avatars, images, and documents
  - SVG rejected from image presets by default
  - Opt-in storage readiness check via `STORAGE_HEALTH_ENABLED`
  - App-mediated download primitive for authorized consumers
  - `POST /auth/me/avatar` and `DELETE /auth/me/avatar` public-read example consumer
  - `docs/storage/` user-facing storage guide
- **OAuth 2.0 / OIDC — Social Login & Account Linking:**
  - `openid-client` v6 (panva) — industry standard, zero transitive deps
  - **Google** provider — OIDC via discovery, PKCE (S256), ID token validation
  - **GitHub** provider — OAuth 2.0, verified primary email via `/user/emails`
  - **Apple** provider — Sign In with Apple, dynamic JWT client secret (P8 key + jose)
  - **Telegram** provider — OIDC, link-only (no email), phone number from ID token
  - Account linking: `GET /auth/oauth/:provider/link` for authenticated users
  - OAuth state + PKCE stored in Redis (TTL 5 min, one-time use, CSRF-protected)
  - Provider factory pattern: providers auto-disabled when env vars missing
  - `GET /auth/oauth/providers` — returns only configured providers
  - `OAUTH_ACCOUNT_ALREADY_LINKED` error code in shared package
  - 14 E2E tests: redirect flow, state validation, new/existing users, email matching, replay prevention
  - 23 unit tests across 5 provider files
- **Auth Documentation:**
  - `docs/auth/README.md` — overview and 30-second mental model
  - `docs/auth/concepts.md` — tokens, sessions, security model
  - `docs/auth/email-auth.md` — register, login, password reset, email verification
  - `docs/auth/sessions.md` — token rotation, session management
  - `docs/auth/oauth.md` — OAuth flows, all 4 providers, account linking
  - `docs/auth/rbac.md` — system roles, org permissions, CASL, caching
  - `docs/auth/api-keys.md` — scopes, create, revoke, security notes
  - `docs/auth/reference.md` — all endpoints, error codes, environment variables

### Added (previous unreleased)

- **RBAC (Role-Based Access Control):**
  - System roles: `USER` / `SUPER_ADMIN` stored in JWT
  - Organization-scoped permissions via CASL + DB-backed roles/permissions
  - `PermissionsCacheService` — Redis cache with `aclVersion`-based invalidation
  - `AbilityFactory` — builds CASL AppAbility with JSON condition interpolation
  - Single `AuthenticationGuard` — JWT → ApiKey → ability build in correct order
  - `@CheckPolicies()`, `@SystemRoles()`, `@Auth()` decorators
  - Organizations module: create, invite members, switch context, role management
  - Admin module: list users/orgs, promote to SUPER_ADMIN (`/admin/*`)
  - Bull Board dashboard protected with `@SystemRoles(SystemRole.SuperAdmin)`
  - Prisma seed: system roles + permissions (`pnpm db:seed`)
  - `docs/authorization.md` — user-facing authorization guide
- **Login Brute-Force Protection:**
  - `LoginRateLimiterService` — Redis-based, no external rate-limit packages
  - Per-IP: 100 failed attempts per 24 hours
  - Per-email+IP: 5 failed attempts per 1 hour → 15-minute block
  - Counters reset on successful login
- **API Key Authentication:**
  - Dual-token format: `amcore_live_{shortToken}_{longToken}`
  - `shortToken` stored in plaintext for O(1) DB lookup; `longToken` SHA-256 hashed
  - Scopes: `action:subject` format, effective = user permissions ∩ key scopes
  - Lazy `lastUsedAt` update via Redis gate (avoids hot row contention)
  - `POST/GET/DELETE /api-keys` — user manages own keys
  - `ApiKeyGuard` — parses `Authorization: Bearer amcore_live_...`, verifies, populates request.user
  - Expired API keys included in nightly `CleanupService` run
  - 15 unit tests, 7 E2E tests
- **Scheduled Tasks:**
  - `CleanupService` — nightly cron at 02:00 UTC
  - Deletes expired sessions, password reset tokens, email verification tokens, and API keys
  - `POST /admin/cleanup` — manual trigger for SUPER_ADMIN
  - Logs deleted counts per table
- **Queue Infrastructure (BullMQ):**
  - Multiple queues: `default` + `email`
  - Default job options: 3 attempts, exponential backoff, auto-cleanup
  - Bull Board dashboard at `/admin/queues`
  - `QueueService` with typed job dispatch
- **Email Service (Resend + React Email):**
  - Provider pattern: `ResendProvider` (prod) / `MockProvider` (dev/test)
  - 4 React Email templates: welcome, password-reset, email-verification, password-changed
  - FormatJS i18n (RU/EN) with ICU Message Format
  - Async dispatch via BullMQ (3 attempts, exponential backoff)
  - Two-framework testing: Jest for logic, Vitest for real template rendering
- **Redis Caching:**
  - `UserCacheService` — cache-aside, 10 min TTL, 50-100x faster auth
  - Distributed locking (stampede protection)
  - Tag-based invalidation (Redis Sets, not `KEYS *`)
  - Null caching (60 s TTL for not-found users)
- **Health Checks:**
  - `GET /health` — DB + Redis + disk + memory
  - `GET /health/startup` — DB + Redis (startup probe)
  - `GET /health/ready` — DB + Redis + disk + memory 1 GB (readiness probe)
  - `GET /health/live` — memory 1.5 GB only (liveness probe, no external deps)
  - Custom `PrismaHealthIndicator` and `RedisHealthIndicator`
- **E2E Testing Infrastructure:**
  - Testcontainers: real PostgreSQL 16 + Redis 7 per test suite
  - 5 suites: auth (42), organizations (10), admin (7), api-keys (7), oauth (14)

### Added (initial foundation)

- **Phase 0: Foundation**
  - Monorepo setup with pnpm workspaces + Turborepo
  - NestJS 10 backend with modular architecture
  - Next.js 16 frontend with App Router and React Compiler
  - PostgreSQL 16 with Prisma 6 ORM (multi-schema: core, fitness, finance, subscriptions)
  - Redis integration for caching and sessions
  - JWT authentication with refresh tokens (rotation, httpOnly cookie)
  - User registration and login endpoints
  - Session management (list, revoke, revoke all)
  - Password reset flow (forgot-password → reset-password)
  - Email verification flow (verify-email → resend-verification)
  - Rate limiting for auth operations (3/hour per email via Redis)
  - Account enumeration prevention
  - Environment variable validation with Zod (crashes fast on bad config)
  - 3-layer exception filters: `AllExceptionsFilter`, `PrismaClientExceptionFilter`, `HttpExceptionFilter`
  - Domain exceptions: `AppException`, `NotFoundException`, `ConflictException`, `BusinessRuleViolationException`
  - Structured logging with Pino: correlation ID, GDPR IP anonymization, sensitive data redaction
  - Graceful shutdown (SIGTERM/SIGINT, log flush before exit)
  - Global rate limiting (10 req/s + 100 req/min)
  - Helmet, CORS, cookie parser
  - Swagger/OpenAPI at `/docs`
  - Feature-Sliced Design (FSD) frontend architecture
  - Tailwind CSS 4 + shadcn/ui
  - Zustand for client state, TanStack Query for server state
  - Docker Compose for local development (multi-stage Dockerfile)
  - CI/CD pipeline (lint, typecheck, test, build — 4 parallel jobs)
  - Dependabot for automated dependency updates
  - ESLint + Prettier + Husky + lint-staged + commitlint

## 0.0.1 - 2026-01-27

### Added

- Initial repository setup
- Basic project structure
- README with project overview
- MIT License

---

[unreleased]: https://github.com/alex-morozov84/AMCore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alex-morozov84/AMCore/releases/tag/v0.1.0
