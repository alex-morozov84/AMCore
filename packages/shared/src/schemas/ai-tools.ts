import { z } from 'zod'

import { aiIdentifierSchema } from './ai-common'
import { aiToolInvocationStatusSchema, aiToolRiskClassSchema } from './ai-enums'

/**
 * AI capability layer — self-hosted tool contracts (Track C — ADR-054, Arc E).
 *
 * The stable **read-only** projection of `AiToolInvocation`. It is deliberately **content-free**:
 * the invocation's `argsSnapshot`/`resultSummary` never cross this wire — only bounded lifecycle,
 * risk, and outcome fields. The tool *definition* (its Zod parameter schema + `execute`) is a
 * worker-side code contract, not a wire shape, so it lives in the API (`infrastructure/ai/tools`),
 * never here.
 */

export const aiToolInvocationResponseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  toolId: aiIdentifierSchema,
  status: aiToolInvocationStatusSchema,
  riskClass: aiToolRiskClassSchema,
  approvalId: z.string().nullable(),
  errorCode: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})
export type AiToolInvocationResponse = z.infer<typeof aiToolInvocationResponseSchema>
