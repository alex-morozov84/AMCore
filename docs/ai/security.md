# AI Security, Guardrails, Audit, and Metrics

AMCore treats model input/output, user files, and tool results as untrusted. The
AI layer is designed for containment and accountability, not a guarantee that a
model can never be manipulated.

## Trust Boundary

The worker builds provider requests with trusted instructions separated from
untrusted user/tool/file content:

- trusted assistant/system instruction goes in `system`;
- user text is wrapped in a salted untrusted-data container;
- tool results re-enter as untrusted data;
- image/PDF artifacts are sibling parts in the untrusted user turn;
- untrusted content is never promoted to `system`.

Assistant prompts are trusted admin text, but AMCore always appends the structural
boundary policy.

## Guardrails

Input guard:

- scans untrusted text;
- `off` disables it;
- `flag` records/counts findings but does not block;
- `block` hard-blocks attacks on AMCore's own envelope/markers.

Output guard:

- always runs before persistence;
- discards model output that leaks boundary/preamble markers or hidden
  instructions;
- writes a safe refusal instead of persisting unsafe output.

Oversize text input is refused with a bounded terminal reason.

## Multimodal Residual Risk

Guardrails scan text only. Text rendered inside an image or embedded in a PDF is
not inspected. Visual / embedded-text prompt injection is a documented
residual risk: contained by channel separation, never claimed eliminated.

AMCore does not ship malware scanning, OCR, DLP, moderation, or AV product
integration.

## Execution Integrity

- Every durable executor write of a leased run is fenced by a lease verified with
  the database's clock inside the writing transaction; a stalled or replaced worker writes
  nothing (see [Runs](./runs.md#ownership-only-the-current-worker-writes)).
- A side-effecting tool is never replayed after an uncertain outcome; the run
  stops with `tool_effect_unknown` and the uncertain action stays visible
  (see [Tools and approvals](./tools-and-approvals.md#replay-effects-and-uncertain-outcomes)).
- Approval previews are immutable plain text bound to the action hash. Only the
  owner with current domain read rights sees the preview; approval and execution
  recheck current rights. SUPER_ADMIN cannot decide for another owner. Raw intent,
  arguments and prepared notification requests remain private and outside Console
  diagnostics and queue payloads.
- Attempt history and terminal reasons carry bounded codes without prompt,
  output or tool arguments. History is keyed by run and epoch; the guard's
  admission metric has no run, conversation or user identifiers in its labels.
- Cancellation is cooperative. A provider call or tool already in flight is not
  forcibly stopped; the worker waits at most its timeout, records the outcome and
  starts nothing further. Abort signals are forwarded to providers and tools, but a
  provider that ignores them may still complete or bill the call.

## Audit

Audit metadata is content-free. It carries bounded ids/codes, never prompts,
message text, file bytes, storage keys, tool args/results, provider payloads, or
free-form reason text.

Privileged read events:

- `ai.conversation.transcript_accessed` — cross-user transcript read only;
- `ai.conversation.artifact_accessed` — cross-user artifact download only.

These privileged reads use strict fail-closed audit: content is not served until
the audit row is written.

State-changing actions such as assistant admin mutations, takeover/release,
operator messages, and approval decisions are audited in the same transaction as
the mutation when applicable.

## Metrics

AI metrics are low-cardinality and content-free. See the full catalog in
[Observability](../operations/observability.md).

Examples:

- `amcore_ai_generations_total{provider,operation,result,role}`;
- `amcore_ai_guardrail_checks_total{stage,verdict,role}`;
- `amcore_ai_tool_invocations_total{tool_id,risk_class,outcome,role}`;
- `amcore_ai_artifact_uploads_total{kind,result,role}`;
- `amcore_ai_artifact_resolution_total{result,role}`.

Forbidden as labels: user id, conversation id, run id, artifact id, model slug,
prompt/response text, provider body, storage key, hash, filename, content type,
tool args/results, and credentials.

## Logs

Pino redaction and audit sanitizers prevent operator reasons, operator-message
content, prompts, provider bodies, and file metadata from entering logs. Error
responses use bounded machine-readable codes.

## Configuration

| Env var                             | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `AI_GUARDRAIL_INPUT_MODE`           | `off`, `flag`, or `block`; default `flag`. |
| `AI_GUARDRAIL_MAX_INPUT_CHARS`      | Max untrusted text size before refusal.    |
| `AI_REQUEST_TIMEOUT_MS`             | Provider-call timeout.                     |
| `AI_TOOL_EXECUTION_TIMEOUT_MS`      | Per-tool timeout.                          |
| `AI_APPROVAL_TTL_MS`                | Approval waiting time before expiry.       |
| `AI_ARTIFACT_MAX_IMAGE_BYTES`       | Max raw image upload size.                 |
| `AI_ARTIFACT_MAX_DOCUMENT_BYTES`    | Max raw PDF upload size.                   |
| `AI_ARTIFACT_MAX_PARTS_PER_MESSAGE` | Max artifact refs per run input.           |

## Provider refusal and accounting boundary

Refusal receipts contain only diagnostic identities, provider family, bounded
finish classification/duration/tool count and normalized usage. They never carry
text, objects, tool arguments, headers, body, destination, credential or raw SDK
cause. The exception carrier is private nonserialized storage; error DTOs do not
expose it. No raw SDK payload is written to the ledger or logs.

Detection follows the installed SDK's `content-filter` finish reason for both text
and structured output. A schema-valid object is still rejected when that finish
reason reports filtering; only safe observed usage is retained. Caller abort after
observation takes precedence over filter classification. Its
OpenAI-compatible adapter does not expose `message.refusal`; AMCore does not claim
to detect every provider safety refusal. Structured-output validation failures
retain observed usage when the SDK supplies response evidence. A timeout before
observation does not invent usage. See [Runs](./runs.md#usage-after-refusal) and
[Providers](./providers.md#frozen-execution-and-live-permission) for atomic
settlement and credential-destination admission.
