# AI Tools and Approvals

Tools are backend code, not prompt text and not database rows. The model can
request only a registered tool that is also listed in the bound assistant's
`toolAllowlist`. Execution happens host-side in the worker after arguments are
Zod-validated and an `AiToolInvocation` is persisted.

## Built-in Tool

The starter ships one SAFE reference tool: `current_time`. It returns the current
UTC time, has no side effect, and is not on any assistant allowlist by default.

## Add a Tool

```ts
// apps/api/src/infrastructure/ai/tools/reference/echo.tool.ts
import { AiToolRiskClass } from '@/generated/prisma/client'
import { z } from 'zod'

import type { AiTool } from '../ai-tool.types'

const parameters = z
  .object({
    text: z.string().min(1).max(200),
  })
  .strict()

export const echoTool: AiTool<z.infer<typeof parameters>> = {
  toolId: 'echo',
  displayName: 'Echo',
  description: 'Echoes short text back to the assistant. Use only for testing tool wiring.',
  parameters,
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'read_only',
  async execute(args) {
    return { output: args.text }
  },
}
```

Register it in `AiToolsModule` by adding it to the `AI_TOOLS` provider array,
then publish an assistant version whose `toolAllowlist` includes `"echo"`.

## Tool Rules

- Tool ids are bounded lowercase snake-case identifiers; duplicates fail startup.
- `SAFE` runs automatically.
- `SENSITIVE` and `DESTRUCTIVE` park the run for owner approval.
- `unsafe` idempotency is rejected by the registry. Declare `read_only` for a tool
  with no external effect and `idempotent` for a tool that changes something
  outside AMCore.
- A side-effecting tool must pass `ctx.idempotencyKey` downstream (see
  [Side effects and uncertain outcomes](#side-effects-and-uncertain-outcomes)).
- Tools must enforce their own domain authorization using `ctx.ownerUserId` /
  `ctx.organizationId`.
- Tool output is plain text and re-enters the model as untrusted data. Do not put
  secrets or large payloads in it.

## Side Effects and Uncertain Outcomes

A model that requests a tool produces one **action**: the run records it durably
*before* anything happens (the requested tool, its validated arguments, its
idempotency class, and which provider call asked for it). One requested action is
exactly one record — it is never created twice, and it is never replaced by a
fresh action when a worker crashes or times out. `ctx.idempotencyKey` is
`ai-tool:<action id>` and stays the same for the action's whole life.

A tool execution ends in one of four outcomes:

| Outcome              | When                                                                                          | What the run does                                          |
| -------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| succeeded            | `execute` returned.                                                                           | The result is applied to the transcript exactly once; the loop continues. |
| rejected, no effect  | `execute` threw `AiToolRejectedError` (it refused the call and is **certain** nothing happened). | The run fails `tool_execution_failed`.                     |
| retryable, no effect | `execute` threw `AiToolRetryableError` (certain nothing happened; a later retry is reasonable). | The run fails `tool_execution_failed`; the code is recorded as `tool_retryable_no_effect`. |
| effect unknown       | Anything else from an `idempotent` tool: a timeout, a thrown error, a crash or lost lease while it ran. | The action becomes `outcome_unknown`; the run fails `tool_effect_unknown`. |

An exception does **not** prove nothing happened (a request can be accepted and
the connection reset afterwards), and a timeout says nothing about the remote
side — so only an explicit no-effect error is trusted. After an unknown outcome
the run **stops**: it does not call the tool again, does not ask the model for a
replacement action, and keeps the uncertain action visible. A `read_only` tool
has no effect to be unsure about: a failure is a plain failure, and a read-only
call interrupted by a crash is safely repeated by the next attempt.

A cancel, takeover or deadline that arrives while the tool runs never erases its
outcome: the result (or the uncertainty) is recorded, nothing further starts, and
the run ends as the stop cause without applying the tool's result to a transcript
that will not continue.

A side-effecting tool, with `documents` standing in for your own domain service
(the no-effect errors live in
`apps/api/src/infrastructure/ai/tools/ai-tool-error.ts`):

```ts
// apps/api/src/infrastructure/ai/tools/reference/archive-document.tool.ts
import { AiToolRejectedError } from '../ai-tool-error'

export const archiveDocumentTool: AiTool<z.infer<typeof parameters>> = {
  toolId: 'archive_document',
  displayName: 'Archive document',
  description: 'Archives one document the user owns.',
  parameters, // z.object({ documentId: z.string() }).strict()
  riskClass: AiToolRiskClass.SENSITIVE,
  idempotency: 'idempotent',
  async execute(args, ctx) {
    const doc = await documents.findOwned(ctx.ownerUserId, args.documentId)
    if (!doc) throw new AiToolRejectedError() // certain: nothing happened
    // The key makes a repeated call a no-op downstream. The tool author owns that guarantee.
    await documents.archive(doc.id, { idempotencyKey: ctx.idempotencyKey, signal: ctx.signal })
    return { output: 'archived' }
  },
}
```

Requirements the tool author owns:

- **Honour the key and the signal.** Pass `ctx.idempotencyKey` to the downstream
  call and `ctx.signal` (aborted at `AI_TOOL_EXECUTION_TIMEOUT_MS`, the run's
  lifetime or worker shutdown). Cancellation is cooperative; AMCore bounds how
  long it waits, but a tool that ignores the signal keeps its worker slot until
  it returns.
- **Be re-parseable.** The stored arguments are the action. When an action is
  resumed (after a crash or an approval) they are validated again and must parse
  to *themselves*; if a schema transform makes `parse(parse(x))` differ from
  `parse(x)`, or the schema changed incompatibly after a deploy, the action is
  not executed and the run fails `tool_schema_incompatible`.
- **Know your downstream's key retention.** Providers typically keep idempotency
  keys for a bounded time (often about a day). AMCore does not replay a
  side-effecting tool after an uncertain outcome, so retention only matters if you
  add your own reconciliation.

## Approval Flow

When a model requests a non-SAFE allowlisted tool, the run moves to
`waiting_approval` and `GET /ai/runs/:id` returns `pendingApprovalId`.

```bash
curl /ai/approvals?status=pending -H 'Authorization: Bearer <owner-jwt>'

curl -X POST /ai/approvals/<approval-id>/decision \
  -H 'Authorization: Bearer <owner-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve","reason":"User confirmed this action"}'
```

Rejecting an approval resumes the run with a fixed “tool rejected” notice; the
tool is not executed.

An approval that is not decided within `AI_APPROVAL_TTL_MS` expires and the run
terminates; it also cannot outlive the run's own lifetime (`AI_RUN_DEADLINE_MS`).
Cancelling a waiting run voids its pending approval, and an approved tool that
has not started when the run is cancelled never runs.

The `/ai/approvals` endpoint shapes (list, filterable by status; decision) are in
the OpenAPI document at `/docs`. **Only the conversation owner can decide
approvals** — cross-user operators can take over or review a conversation but
never receive approval authority.

## Configuration

| Env var                        | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `AI_TOOL_LOOP_MAX_STEPS`       | Max provider steps per run before `tool_loop_exhausted`. |
| `AI_TOOL_EXECUTION_TIMEOUT_MS` | Per-tool host-side execution timeout.                    |
| `AI_APPROVAL_TTL_MS`           | How long a run may wait for approval before expiry.      |
| `AI_RUN_DEADLINE_MS`           | Absolute lifetime of a run, including approval waits.    |
