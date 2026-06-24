import { z } from 'zod'

import { aiIdentifierSchema, aiModalitySchema, aiSlugSchema } from './ai-common'
import { aiDisplayNameSchema } from './ai-catalog'

/**
 * AI capability layer — assistant config contracts (Track C — ADR-054, Arc A).
 *
 * Named, versioned assistant configs (the prompt-version store, basic form) — the
 * engine-side admin contract; UI deferred (D6). `systemPrompt` is trusted instruction text,
 * kept structurally distinct from untrusted user/tool content at the gateway trust boundary
 * (Arc D). Exercised from Arc F. Language-agnostic, no human-readable messages.
 */

/** Logical model selection: a primary model slug plus an ordered fallback chain. */
export const aiModelSelectionSchema = z.object({
  modelSlug: aiSlugSchema,
  fallback: z.array(aiSlugSchema).max(8).default([]),
})
export type AiModelSelection = z.infer<typeof aiModelSelectionSchema>

export const AI_SYSTEM_PROMPT_MAX_LENGTH = 16_000

export const aiAssistantResponseSchema = z.object({
  id: z.string(),
  slug: aiSlugSchema,
  version: z.number().int().positive(),
  displayName: aiDisplayNameSchema,
  enabled: z.boolean(),
  systemPrompt: z.string().nullable(),
  modelSelection: aiModelSelectionSchema,
  allowedModalities: z.array(aiModalitySchema),
  toolAllowlist: z.array(aiIdentifierSchema),
  budgetClass: aiIdentifierSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AiAssistantResponse = z.infer<typeof aiAssistantResponseSchema>

export const createAiAssistantSchema = z.object({
  slug: aiSlugSchema,
  displayName: aiDisplayNameSchema,
  enabled: z.boolean().default(false),
  systemPrompt: z.string().max(AI_SYSTEM_PROMPT_MAX_LENGTH).nullish(),
  modelSelection: aiModelSelectionSchema,
  allowedModalities: z.array(aiModalitySchema).default(['text']),
  toolAllowlist: z.array(aiIdentifierSchema).max(64).default([]),
  budgetClass: aiIdentifierSchema.nullish(),
})
export type CreateAiAssistantInput = z.infer<typeof createAiAssistantSchema>
