import { z } from 'zod'

import {
  aiCapabilityMapSchema,
  aiConfigObjectSchema,
  aiIdentifierSchema,
  aiProviderTypeSchema,
  aiSlugSchema,
} from './ai-common'

/**
 * AI capability layer — provider/model/policy catalog contracts (Track C — ADR-054, Arc A).
 *
 * The DB-backed, admin-manageable catalog (owner R6/R7). These are the **engine-side** admin
 * contracts; the admin UI is deferred to the frontend phase (D6). No secret is ever present:
 * a provider exposes only its logical `credentialSlot` (resolved through a code-owned per-type
 * allowlist at runtime), never a key; `config` is a bounded non-secret object. Assistant
 * configs live in `ai-assistants.ts`. Language-agnostic, no human-readable messages.
 */

export const aiDisplayNameSchema = z.string().min(1).max(120)

// ----- Provider -----

export const aiProviderResponseSchema = z.object({
  id: z.string(),
  slug: aiSlugSchema,
  type: aiProviderTypeSchema,
  displayName: aiDisplayNameSchema,
  baseUrl: z.url().nullable(),
  enabled: z.boolean(),
  dataRetentionClass: aiIdentifierSchema,
  credentialSlot: aiIdentifierSchema.nullable(),
  config: aiConfigObjectSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AiProviderResponse = z.infer<typeof aiProviderResponseSchema>

export const createAiProviderSchema = z.object({
  slug: aiSlugSchema,
  type: aiProviderTypeSchema,
  displayName: aiDisplayNameSchema,
  baseUrl: z.url().nullish(),
  enabled: z.boolean().default(false),
  dataRetentionClass: aiIdentifierSchema.default('provider_default'),
  credentialSlot: aiIdentifierSchema.nullish(),
  config: aiConfigObjectSchema.nullish(),
})
export type CreateAiProviderInput = z.infer<typeof createAiProviderSchema>

/** Admin update — every field optional; `slug`/`type` are immutable once created. */
export const updateAiProviderSchema = z.object({
  displayName: aiDisplayNameSchema.optional(),
  baseUrl: z.url().nullish(),
  enabled: z.boolean().optional(),
  dataRetentionClass: aiIdentifierSchema.optional(),
  credentialSlot: aiIdentifierSchema.nullish(),
  config: aiConfigObjectSchema.nullish(),
})
export type UpdateAiProviderInput = z.infer<typeof updateAiProviderSchema>

// ----- Model -----

export const aiModelResponseSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  slug: aiSlugSchema,
  providerModelName: z.string().min(1).max(256),
  displayName: aiDisplayNameSchema,
  enabled: z.boolean(),
  isDefault: z.boolean(),
  priority: z.number().int(),
  capabilities: aiCapabilityMapSchema,
  contextLimit: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  deprecatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AiModelResponse = z.infer<typeof aiModelResponseSchema>

export const createAiModelSchema = z.object({
  providerId: z.string().min(1),
  slug: aiSlugSchema,
  providerModelName: z.string().min(1).max(256),
  displayName: aiDisplayNameSchema,
  enabled: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  priority: z.number().int().default(0),
  capabilities: aiCapabilityMapSchema,
  contextLimit: z.number().int().positive().nullish(),
  maxOutputTokens: z.number().int().positive().nullish(),
})
export type CreateAiModelInput = z.infer<typeof createAiModelSchema>

export const updateAiModelSchema = z.object({
  displayName: aiDisplayNameSchema.optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  priority: z.number().int().optional(),
  capabilities: aiCapabilityMapSchema.optional(),
  contextLimit: z.number().int().positive().nullish(),
  maxOutputTokens: z.number().int().positive().nullish(),
})
export type UpdateAiModelInput = z.infer<typeof updateAiModelSchema>

// ----- Model policy -----

export const aiModelPolicyResponseSchema = z.object({
  modelId: z.string(),
  allowedUseCases: z.array(aiIdentifierSchema),
  maxTokens: z.number().int().positive().nullable(),
  dataRetentionRequired: z.boolean(),
  fallbackEligible: z.boolean(),
})
export type AiModelPolicyResponse = z.infer<typeof aiModelPolicyResponseSchema>

export const updateAiModelPolicySchema = z.object({
  allowedUseCases: z.array(aiIdentifierSchema).max(64).optional(),
  maxTokens: z.number().int().positive().nullish(),
  dataRetentionRequired: z.boolean().optional(),
  fallbackEligible: z.boolean().optional(),
})
export type UpdateAiModelPolicyInput = z.infer<typeof updateAiModelPolicySchema>
