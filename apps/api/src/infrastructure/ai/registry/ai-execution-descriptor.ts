import { createHash } from 'node:crypto'

import { z } from 'zod'

import { aiCapabilityMapSchema, aiSlugSchema } from '@amcore/shared'

import type { ResolvedAiModel } from './ai-registry.types'

import { AiProviderType } from '@/generated/prisma/client'

const id = z.string().min(1).max(128)
const cap = z.number().int().positive().max(2147483647).nullable()
export const aiExecutionDescriptorSchema = z.strictObject({
  version: z.literal(1),
  modelId: id,
  providerId: id,
  modelSlug: aiSlugSchema,
  providerSlug: aiSlugSchema,
  providerType: z.enum(AiProviderType),
  providerModelName: z.string().min(1).max(256),
  capabilities: aiCapabilityMapSchema,
  contextLimit: cap,
  maxOutputTokens: cap,
  credentialSlot: z.enum(['default']).nullable(),
  endpoint: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('built_in') }),
    z.strictObject({ kind: z.literal('compatible'), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  ]),
})
export type AiExecutionDescriptor = z.infer<typeof aiExecutionDescriptorSchema>

/** Deployment-owned custom endpoint. No alternate destination or redirect may receive its secret. */
export function canonicalCompatibleEndpoint(raw: string | null): string {
  if (
    !raw ||
    raw.length > 2048 ||
    [...raw].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('invalid_ai_endpoint')
  const url = new URL(raw)
  const authority = raw
    .match(/^[a-z]+:\/\/([^/]+)/i)?.[1]
    ?.replace(/:\d+$/, '')
    .toLowerCase()
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(authority ?? '')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('invalid_ai_endpoint')
  if (!url.hostname || url.username || url.password || /[?#]/.test(raw) || url.search || url.hash)
    throw new Error('invalid_ai_endpoint')
  return url.toString().replace(/\/+$/, '')
}

export function endpointBinding(model: ResolvedAiModel): AiExecutionDescriptor['endpoint'] {
  return model.provider.type === AiProviderType.OPENAI_COMPATIBLE
    ? {
        kind: 'compatible',
        sha256: createHash('sha256')
          .update(canonicalCompatibleEndpoint(model.provider.baseUrl))
          .digest('hex'),
      }
    : { kind: 'built_in' }
}

export function freezeAiModel(model: ResolvedAiModel): AiExecutionDescriptor {
  return aiExecutionDescriptorSchema.parse({
    version: 1,
    modelId: model.id,
    providerId: model.provider.id,
    modelSlug: model.slug,
    providerSlug: model.provider.slug,
    providerType: model.provider.type,
    providerModelName: model.providerModelName,
    capabilities: model.capabilities,
    contextLimit: model.contextLimit,
    maxOutputTokens: model.maxOutputTokens,
    credentialSlot:
      model.provider.type === AiProviderType.MOCK ? null : model.provider.credentialSlot,
    endpoint: endpointBinding(model),
  })
}

export function descriptorFailure(
  value: unknown
): 'model_snapshot_legacy_unsupported' | 'model_snapshot_invalid' {
  return value && typeof value === 'object' && !Array.isArray(value) && !('version' in value)
    ? 'model_snapshot_legacy_unsupported'
    : 'model_snapshot_invalid'
}
