import { z } from 'zod'

import { aiCapabilityMapSchema, aiConfigObjectSchema } from '@amcore/shared'

import { AiProviderType } from '@/generated/prisma/client'

/**
 * Resolved catalog shapes (Track C — ADR-054, Arc B) — the DB-derived, secret-free projections
 * the gateway dispatches on. Defined as Zod schemas so the **trust boundary is enforced**, not
 * assumed: a DB row's `capabilities`/`config` JSON and a Redis cache snapshot are both validated
 * against the bounded shared schemas (`aiCapabilityMapSchema` / `aiConfigObjectSchema`) before
 * they are trusted — a structurally bad row never reaches the gateway as trusted config (A.2
 * invariant). `credentialSlot` is a logical id resolved to a secret only by the resolver.
 */

export const resolvedAiProviderSchema = z.object({
  slug: z.string(),
  type: z.enum(AiProviderType),
  baseUrl: z.string().nullable(),
  credentialSlot: z.string().nullable(),
  dataRetentionClass: z.string(),
  config: aiConfigObjectSchema.nullable(),
})
export type ResolvedAiProvider = z.infer<typeof resolvedAiProviderSchema>

export const resolvedAiModelSchema = z.object({
  slug: z.string(),
  providerModelName: z.string(),
  capabilities: aiCapabilityMapSchema,
  contextLimit: z.number().int().nullable(),
  maxOutputTokens: z.number().int().nullable(),
  isDefault: z.boolean(),
  provider: resolvedAiProviderSchema,
})
export type ResolvedAiModel = z.infer<typeof resolvedAiModelSchema>

/** The cached snapshot: every enabled, schema-valid model (with its provider) in the catalog. */
export const aiCatalogSnapshotSchema = z.array(resolvedAiModelSchema)
export type AiCatalogSnapshot = z.infer<typeof aiCatalogSnapshotSchema>
