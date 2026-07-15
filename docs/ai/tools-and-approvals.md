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
import { AiToolRiskClass } from '@prisma/client'
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
- `unsafe` idempotency is rejected by the registry.
- A side-effecting tool must be idempotent and use `ctx.idempotencyKey`
  downstream.
- Tools must enforce their own domain authorization using `ctx.ownerUserId` /
  `ctx.organizationId`.
- Tool output is plain text in this arc and re-enters the model as untrusted data.
  Do not put secrets or large payloads in it.

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

## API

| Method + path                     | Purpose                                      |
| --------------------------------- | -------------------------------------------- | -------- | -------- | ---------- |
| `GET /ai/approvals`               | List owned approvals (`?status=pending       | approved | rejected | expired`). |
| `POST /ai/approvals/:id/decision` | Approve or reject an owned pending approval. |

Only the conversation owner can decide approvals. Cross-user operators can take
over/review a conversation, but do not receive approval authority in this arc.

## Configuration

| Env var                        | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `AI_TOOL_LOOP_MAX_STEPS`       | Max provider steps per run before `tool_loop_exhausted`. |
| `AI_TOOL_EXECUTION_TIMEOUT_MS` | Per-tool host-side execution timeout.                    |
| `AI_APPROVAL_TTL_MS`           | How long a run may wait for approval before expiry.      |
