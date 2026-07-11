import { z } from 'zod'

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
