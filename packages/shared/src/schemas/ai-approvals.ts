import { z } from 'zod'

import { aiApprovalPreviewSchema, aiIntentHashSchema } from './ai-approval-intent'
import { aiIdentifierSchema } from './ai-common'
import { aiApprovalKindSchema, aiApprovalStateSchema, aiToolRiskClassSchema } from './ai-enums'

/** Owner-scoped approval metadata and current-rights-authorized plain-text intent preview.
 * Raw arguments, prompts and provider output remain private. Decisions bind the displayed hash.
 */

/** Max length of a bounded, human-supplied approval reason (request or decision). */
export const AI_APPROVAL_REASON_MAX_LENGTH = 500

export const aiApprovalResponseSchema = z.object({
  id: z.string(),
  runId: z.string().nullable(),
  conversationId: z.string().nullable(),
  kind: aiApprovalKindSchema,
  state: aiApprovalStateSchema,
  /** Tool identity; the separate preview is disclosed only with current domain read rights. */
  toolId: aiIdentifierSchema.nullable(),
  riskClass: aiToolRiskClassSchema.nullable(),
  toolVersion: z.number().int().positive().nullable(),
  intentHash: aiIntentHashSchema.nullable(),
  preview: aiApprovalPreviewSchema.nullable(),
  disclosure: z.enum(['available', 'unavailable', 'legacy']),
  requestedReason: z.string().max(AI_APPROVAL_REASON_MAX_LENGTH).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type AiApprovalResponse = z.infer<typeof aiApprovalResponseSchema>

/** The owner's approvals (bounded, newest first) — approvals are few, so this is not paginated. */
export const aiApprovalListResponseSchema = z.object({
  data: z.array(aiApprovalResponseSchema),
})
export type AiApprovalListResponse = z.infer<typeof aiApprovalListResponseSchema>

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
export const decideAiApprovalSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    intentHash: aiIntentHashSchema,
    reason: z.string().min(1).max(AI_APPROVAL_REASON_MAX_LENGTH).nullish(),
  })
  .strict()
export type DecideAiApprovalInput = z.infer<typeof decideAiApprovalSchema>
