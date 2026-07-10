import { z } from 'zod'

import { aiIdentifierSchema } from './ai-common'
import { aiApprovalKindSchema, aiApprovalStateSchema, aiToolRiskClassSchema } from './ai-enums'

/**
 * AI capability layer — human-in-the-loop approval contracts (Track C — ADR-054, Arc E).
 *
 * The read projection of `AiApproval` plus the owner decision input. Content-free: the approver
 * sees **what** they are gating (`toolId`, `riskClass`, a bounded `requestedReason`) but never the
 * tool arguments, prompt, or model output. The decision input is the only mutation — the endpoints
 * that serve/consume these land in Arc E.5; the wire lifecycle enums already exist in `ai-enums`.
 */

/** Max length of a bounded, human-supplied approval reason (request or decision). */
export const AI_APPROVAL_REASON_MAX_LENGTH = 500

export const aiApprovalResponseSchema = z.object({
  id: z.string(),
  runId: z.string().nullable(),
  conversationId: z.string().nullable(),
  kind: aiApprovalKindSchema,
  state: aiApprovalStateSchema,
  /** The tool context the owner is approving — id + risk only, never the arguments (content-free). */
  toolId: aiIdentifierSchema.nullable(),
  riskClass: aiToolRiskClassSchema.nullable(),
  requestedReason: z.string().max(AI_APPROVAL_REASON_MAX_LENGTH).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type AiApprovalResponse = z.infer<typeof aiApprovalResponseSchema>

/** List owned approvals, optionally filtered by state (e.g. `?status=pending`). */
export const aiApprovalListQuerySchema = z.object({
  status: aiApprovalStateSchema.optional(),
})
export type AiApprovalListQuery = z.infer<typeof aiApprovalListQuerySchema>

/**
 * The owner's decision on a pending approval. `approve` proceeds with the gated tool; `reject`
 * resumes the run feeding a "tool rejected" result. A repeat of the same decision is idempotent
 * (the PENDING CAS in Arc E.5); a conflicting second decision is refused, never applied.
 */
export const decideAiApprovalSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(AI_APPROVAL_REASON_MAX_LENGTH).nullish(),
})
export type DecideAiApprovalInput = z.infer<typeof decideAiApprovalSchema>
