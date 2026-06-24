import { z } from 'zod'

/**
 * AI capability layer — wire lifecycle enums (Track C — ADR-054, Arc A).
 *
 * The **lowercase projection** of the Prisma lifecycle enums — the API never leaks
 * SCREAMING_CASE DB tokens. Lifecycle sets are closed and complete, so enums are correct
 * here (unlike the open capability/modality axes, which are bounded strings in `ai-common`).
 */

/** Run lifecycle (projection of `AiRunStatus`). */
export const aiRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_approval',
  'waiting_human',
  'completed',
  'failed',
  'cancelled',
  'expired',
])
export type AiRunStatusValue = z.infer<typeof aiRunStatusSchema>

/** Conversation control-ownership (projection of the Prisma enums). */
export const aiConversationStateSchema = z.enum(['active', 'paused_for_human', 'closed'])
export const aiConversationControlSchema = z.enum(['bot', 'human'])

/** Transcript message vocabulary. */
export const aiMessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])
export const aiAuthorTypeSchema = z.enum(['user', 'assistant', 'operator', 'system'])

/** Tool/approval vocabulary (exercised from Arc E/F; the wire contract is stable now). */
export const aiToolRiskClassSchema = z.enum(['safe', 'sensitive', 'destructive'])
export const aiToolInvocationStatusSchema = z.enum([
  'requested',
  'awaiting_approval',
  'approved',
  'rejected',
  'executing',
  'succeeded',
  'failed',
  'skipped',
])
export const aiApprovalKindSchema = z.enum(['tool_invocation', 'handoff', 'sensitive_action'])
export const aiApprovalStateSchema = z.enum(['pending', 'approved', 'rejected', 'expired'])

/** Multimodal artifact vocabulary (exercised from Arc G). */
export const aiArtifactKindSchema = z.enum([
  'file',
  'image',
  'pdf',
  'generated_image',
  'tool_result',
])
export const aiArtifactTrustLevelSchema = z.enum(['trusted', 'untrusted'])
