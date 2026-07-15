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
not inspected in Arc G. Visual / embedded-text prompt injection is a documented
residual risk: contained by channel separation, never claimed eliminated.

Arc G also does not ship malware scanning, OCR, DLP, moderation, or AV product
integration.

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
