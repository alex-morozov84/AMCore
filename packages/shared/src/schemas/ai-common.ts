import { z } from 'zod'

/**
 * AI capability layer — shared contract primitives (Track C — ADR-054, Arc A).
 *
 * Language-agnostic: no human-readable messages here. Capability/modality/use-case
 * identifiers are validated as **bounded strings**, not fixed enums, so a new
 * capability/modality stays additive — the active set is owned by the catalog and surfaced
 * at runtime, never advertised as a dead enum value (ADR-052 lesson). Provider *type* is
 * the one closed, code-bound discriminator → an enum (ADR-054). Wire lifecycle enums live
 * in `ai-enums.ts`.
 */

export const AI_IDENTIFIER_MAX_LENGTH = 48
export const AI_SLUG_MAX_LENGTH = 64

/**
 * Flat identifier grammar (one lowercase snake segment): capability keys, modality ids,
 * use-case ids, budget classes, data-retention classes — e.g. `text`, `structured_output`.
 */
export const aiIdentifierSchema = z
  .string()
  .min(1)
  .max(AI_IDENTIFIER_MAX_LENGTH)
  .regex(/^[a-z][a-z0-9_]*$/)

/**
 * Catalog slug grammar (provider/model/assistant logical ids) — lowercase, hyphen or
 * underscore allowed for readability, e.g. `anthropic-default`, `claude_default`.
 */
export const aiSlugSchema = z
  .string()
  .min(1)
  .max(AI_SLUG_MAX_LENGTH)
  .regex(/^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/)

/** Provider adapter family — the closed, code-bound discriminator (lowercase wire form). */
export const AI_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'openrouter',
  'openai_compatible',
  'yandex_ai_studio',
  'mock',
] as const
export const aiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES)
export type AiProviderTypeValue = z.infer<typeof aiProviderTypeSchema>

/**
 * Known capability keys (the cross-provider common denominator + the additive extras).
 * The schema validates the *grammar*, not this list, so a new capability is purely a
 * catalog/data change; routing code reads the keys it understands.
 */
export const AI_CAPABILITIES = [
  'text',
  'tools',
  'vision',
  'pdf',
  'streaming',
  'structured_output',
  'embeddings',
  'image_generation',
] as const

/**
 * Capability map stored on `AiModel.capabilities`. Bounded-key, boolean-valued, additive.
 * Boundedness comes from the key grammar; entry count is capped so a hostile catalog row
 * cannot store an unbounded blob.
 */
export const AI_CAPABILITY_MAX_ENTRIES = 32
export const aiCapabilityMapSchema = z
  .record(aiIdentifierSchema, z.boolean())
  .refine((value) => Object.keys(value).length <= AI_CAPABILITY_MAX_ENTRIES)
export type AiCapabilityMap = z.infer<typeof aiCapabilityMapSchema>

/** Input modalities a model/assistant accepts (bounded, additive). */
export const AI_MODALITIES = ['text', 'image', 'pdf'] as const
export const aiModalitySchema = z.enum(AI_MODALITIES)

/**
 * Precision-safe decimal **string** for money/cost on the JSON wire (the DB stores
 * `Decimal(18,8)`; a JS number would lose precision). Nonnegative, up to 12 integer and
 * 8 fractional digits — rejects free text like `"abc"`.
 */
export const aiDecimalStringSchema = z.string().regex(/^\d{1,12}(\.\d{1,8})?$/)

/**
 * Bounded non-secret provider config object (e.g. a Yandex `folderId`). This is an
 * admin-editable surface, so it must not become a secret/blob carrier: keys follow a
 * bounded grammar and reject secret-looking names; values are scalars or shallow scalar
 * arrays (no nesting); both key count and value sizes are capped. Provider-specific config
 * schemas may later refine this per type.
 */
export const AI_CONFIG_MAX_KEYS = 32
const aiConfigKeySchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
  .refine(
    (key) =>
      !/secret|password|token|credential|api[_-]?key/i.test(key) && key.toLowerCase() !== 'key'
  )
const aiConfigScalarSchema = z.union([z.string().max(512), z.number(), z.boolean()])
const aiConfigValueSchema = z.union([aiConfigScalarSchema, z.array(aiConfigScalarSchema).max(32)])
export const aiConfigObjectSchema = z
  .record(aiConfigKeySchema, aiConfigValueSchema)
  .refine((value) => Object.keys(value).length <= AI_CONFIG_MAX_KEYS)
export type AiConfigObject = z.infer<typeof aiConfigObjectSchema>
