import { z } from 'zod'

import { PAGINATION } from '../constants'

import { aiMessageContentSchema, aiMessageResponseSchema } from './ai-runs'
import { cursorResponseSchema } from './pagination'

/**
 * AI capability layer — human takeover / operator-review contracts (Track C — ADR-054, Arc F.3).
 *
 * The bearer HTTP surface over the Arc F.2b takeover primitive: take/release control and (Arc F.3b)
 * operator transcript review + human turn. Access is owner **or** a cross-user SUPER_ADMIN operator;
 * the operator path additionally requires step-up freshness + a bounded reason (enforced server-side,
 * not in these schemas). Language-agnostic, no human-readable messages.
 */

/** Max length of the bounded operator reason / ticket ref. */
export const AI_CONTROL_REASON_MAX_LENGTH = 200

/** True if the string contains any C0 control character (checked by code point — no regex literal). */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) if (value.charCodeAt(i) < 0x20) return true
  return false
}

/**
 * A bounded operator reason / ticket ref (e.g. a support ticket id). **Required at runtime only for a
 * cross-user SUPER_ADMIN operator** (the service enforces presence) — an owner acting on their own
 * conversation may omit it. It is a short justification recorded as audit metadata, **never** a place
 * for transcript, prompt, or message content. Control characters are rejected so this validation stays
 * aligned with the audit sanitizer (which drops control-char reasons) — a reason that validates here is
 * a reason that survives into the audit, so the mandatory ticket ref can never silently disappear.
 */
export const aiControlReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(AI_CONTROL_REASON_MAX_LENGTH)
  .refine((v) => !hasControlChar(v), { error: 'Must not contain control characters' })
export type AiControlReason = z.infer<typeof aiControlReasonSchema>

/** Take human control of a conversation (`reason` optional here; required at runtime for cross-user). */
export const takeoverConversationSchema = z.object({ reason: aiControlReasonSchema.optional() })
export type TakeoverConversationInput = z.infer<typeof takeoverConversationSchema>

/** Release control back to the bot (`reason` optional here; required at runtime for cross-user). */
export const releaseConversationSchema = z.object({ reason: aiControlReasonSchema.optional() })
export type ReleaseConversationInput = z.infer<typeof releaseConversationSchema>

/**
 * Post a human turn while holding control (Arc F.3b). `content` is the same multimodal content-part
 * contract as any transcript turn; the server renders it as a `role=ASSISTANT` turn authored by the
 * human (`authorType=OPERATOR` for a cross-user operator, `USER` for the owner). `reason` is required
 * at runtime for a cross-user operator only.
 */
export const postOperatorMessageSchema = z.object({
  content: aiMessageContentSchema,
  reason: aiControlReasonSchema.optional(),
})
export type PostOperatorMessageInput = z.infer<typeof postOperatorMessageSchema>

/** The header a cross-user operator supplies their reason/ticket ref in on the transcript-read GET. */
export const AI_OPERATOR_REASON_HEADER = 'x-amcore-operator-reason'

/**
 * Transcript read query (Arc F.3b). Keyset-paginated by monotonic `sequence` (ascending — oldest
 * first), the conversation's natural order. `cursor` is the last `sequence` already seen. The
 * cross-user operator reason is **not** a query param (that would leak into access-log URLs) — it is
 * supplied in the `x-amcore-operator-reason` header (redacted in logs), validated by the same grammar.
 */
export const aiTranscriptQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
})
export type AiTranscriptQuery = z.infer<typeof aiTranscriptQuerySchema>

export const aiTranscriptResponseSchema = cursorResponseSchema(aiMessageResponseSchema)
export type AiTranscriptResponse = z.infer<typeof aiTranscriptResponseSchema>
