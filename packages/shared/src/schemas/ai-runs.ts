import { z } from 'zod'

import {
  aiArtifactKindSchema,
  aiArtifactTrustLevelSchema,
  aiAuthorTypeSchema,
  aiConversationControlSchema,
  aiConversationStateSchema,
  aiMessageRoleSchema,
  aiRunStatusSchema,
} from './ai-enums'
import { aiDecimalStringSchema, aiSlugSchema } from './ai-common'

/**
 * AI capability layer — durable run/conversation read contracts (Track C — ADR-054, Arc A).
 *
 * Stable read-only projections of the durable models plus the minimal run-creation request.
 * These shapes are fixed now so later arcs are additive; the **endpoints** that serve/extend
 * them land in their arcs (run lifecycle → Arc C, transcript/takeover → Arc F, artifact
 * upload → Arc G), along with pagination, streaming-event, tool-invocation, and approval
 * contracts (deliberately deferred, not speculated here). No secrets in any field.
 */

// ----- Message content parts (the multimodal foundation) -----

export const AI_TEXT_PART_MAX_LENGTH = 32_000
export const AI_MESSAGE_MAX_PARTS = 64

/**
 * One structured message-content part. A discriminated union on `type` so it is additive: a
 * tool-call/tool-result part is added in Arc E without breaking this contract. `artifact_ref`
 * points at a durable `AiArtifact` (image/pdf/file) by id — content bytes never ride the wire
 * here. This is the contract the message transcript and run input both speak (multimodal-ready).
 */
export const aiMessageContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(AI_TEXT_PART_MAX_LENGTH) }),
  z.object({ type: z.literal('artifact_ref'), artifactId: z.string().min(1).max(64) }),
])
export type AiMessageContentPart = z.infer<typeof aiMessageContentPartSchema>

export const aiMessageContentSchema = z
  .array(aiMessageContentPartSchema)
  .min(1)
  .max(AI_MESSAGE_MAX_PARTS)
export type AiMessageContent = z.infer<typeof aiMessageContentSchema>

// ----- Conversation -----

export const aiConversationResponseSchema = z.object({
  id: z.string(),
  assistantId: z.string().nullable(),
  title: z.string().nullable(),
  state: aiConversationStateSchema,
  controlledBy: aiConversationControlSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
})
export type AiConversationResponse = z.infer<typeof aiConversationResponseSchema>

/**
 * Create a conversation. `assistantId` binds a named assistant config; `title` is an optional
 * caller-supplied label. The first turn is sent separately (run creation), so the body stays
 * minimal.
 */
export const createAiConversationSchema = z.object({
  assistantId: z.string().min(1).nullish(),
  title: z.string().min(1).max(200).nullish(),
})
export type CreateAiConversationInput = z.infer<typeof createAiConversationSchema>

// ----- Message (transcript projection) -----

export const aiMessageResponseSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  runId: z.string().nullable(),
  sequence: z.number().int().nonnegative(),
  role: aiMessageRoleSchema,
  authorType: aiAuthorTypeSchema,
  content: aiMessageContentSchema,
  createdAt: z.iso.datetime(),
})
export type AiMessageResponse = z.infer<typeof aiMessageResponseSchema>

// ----- Run -----

export const aiRunResponseSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: aiRunStatusSchema,
  errorCode: z.string().nullable(),
  terminalReasonCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})
export type AiRunResponse = z.infer<typeof aiRunResponseSchema>

/**
 * Create (queue) a run on a conversation. `inputParts` is the user's structured input turn —
 * the same multimodal content-part contract as the transcript, never a flat string — so an
 * image/pdf turn needs no contract change. Generation parameters (model override, tool/
 * approval policy, streaming) are owned by the run-lifecycle arc (Arc C); Arc A fixes only
 * the durable input shape.
 */
export const createAiRunSchema = z.object({
  conversationId: z.string().min(1),
  inputParts: aiMessageContentSchema,
  idempotencyKey: z.string().min(1).max(128).nullish(),
})
export type CreateAiRunInput = z.infer<typeof createAiRunSchema>

// ----- Artifact (multimodal projection) -----

export const aiArtifactResponseSchema = z.object({
  id: z.string(),
  kind: aiArtifactKindSchema,
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  trustLevel: aiArtifactTrustLevelSchema,
  createdAt: z.iso.datetime(),
})
export type AiArtifactResponse = z.infer<typeof aiArtifactResponseSchema>

// ----- Usage summary -----

/**
 * Aggregated, read-only projection of `AiUsageLedger` (no per-call secrets). `estimatedCost`
 * is a precision-safe decimal string; `null` when cost is unknown.
 */
export const aiUsageSummarySchema = z.object({
  modelSlug: aiSlugSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  estimatedCost: aiDecimalStringSchema.nullable(),
  currency: z.string().length(3).nullable(),
})
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>
