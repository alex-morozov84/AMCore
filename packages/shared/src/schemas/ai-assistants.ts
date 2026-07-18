import { z } from 'zod'

import { PAGINATION } from '../constants'

import { aiDisplayNameSchema } from './ai-catalog'
import { aiIdentifierSchema, aiModalitySchema, aiSlugSchema } from './ai-common'
import { paginatedResponseSchema } from './pagination'

/**
 * AI capability layer — assistant config contracts (Track C — ADR-054, Arc A + Arc F admin).
 *
 * Named, versioned assistant configs (the prompt-version store, basic form) — the
 * engine-side admin contract; UI deferred (D6). `systemPrompt` is trusted instruction text,
 * kept structurally distinct from untrusted user/tool content at the gateway trust boundary
 * (Arc D). The admin surface (create / publish-version / update / list) lands in Arc F.1.
 * Language-agnostic, no human-readable messages.
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

/**
 * Publish a new immutable version of an existing assistant `slug` (Arc F.1). The behavioral config
 * of `createAiAssistantSchema` minus `slug` (the slug comes from the path); the server assigns the
 * next `version`. A version row is never mutated in place — any behavioral change publishes a new one.
 */
export const publishAiAssistantVersionSchema = createAiAssistantSchema.omit({ slug: true })
export type PublishAiAssistantVersionInput = z.infer<typeof publishAiAssistantVersionSchema>

/**
 * In-place assistant update (Arc F.1). Deliberately limited to the two **operational** fields —
 * `enabled` (the kill-switch) and `displayName`. Behavioral fields (systemPrompt / modelSelection /
 * toolAllowlist / modalities) are immutable per version and change only via a new version, so a bound
 * conversation's behavior can never be retro-changed under it. At least one field must be present.
 */
export const updateAiAssistantSchema = z
  .object({
    displayName: aiDisplayNameSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.enabled !== undefined, {
    error: 'At least one of displayName or enabled must be provided',
  })
export type UpdateAiAssistantInput = z.infer<typeof updateAiAssistantSchema>

/**
 * Admin assistant list query (Arc F.1). `version` defaults to `latest` (one row per slug, highest
 * version); `all` returns every version. `slug` narrows to a single assistant's versions. Page-based
 * (ADR-036 standard envelope), mirroring the other admin lists.
 */
export const aiAssistantListQuerySchema = z.object({
  slug: aiSlugSchema.optional(),
  version: z.enum(['latest', 'all']).default('latest'),
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
})
export type AiAssistantListQuery = z.infer<typeof aiAssistantListQuerySchema>

export const aiAssistantListResponseSchema = paginatedResponseSchema(aiAssistantResponseSchema)
export type AiAssistantListResponse = z.infer<typeof aiAssistantListResponseSchema>
