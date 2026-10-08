import { normalizeAiUsage } from '../usage/ai-usage-v2'

import type { AiAdapterCall, AiUsage } from './ai-gateway.types'

import type { AiProviderType } from '@/generated/prisma/client'

/** Content-free observation; never place this carrier (or the SDK cause) in AppException.details. */
export interface AiProviderReceipt {
  modelId: string
  providerId: string
  modelSlug: string
  providerType: AiProviderType
  finishReason:
    'stop' | 'length' | 'tool_calls' | 'content_filtered' | 'output_validation_failed' | 'other'
  durationMs: number
  toolCallCount: number
  usage: AiUsage
}
const observations = new WeakMap<object, AiProviderReceipt>()
export function attachProviderReceipt<T extends object>(
  error: T,
  receipt: AiProviderReceipt | undefined
): T {
  if (receipt) observations.set(error, receipt)
  return error
}
export function providerReceipt(error: unknown): AiProviderReceipt | undefined {
  return error !== null && typeof error === 'object' ? observations.get(error) : undefined
}
export function observeProviderReceipt(
  call: AiAdapterCall,
  usage: AiUsage,
  reason: string | undefined,
  started: number,
  tools = 0
): AiProviderReceipt {
  const finishReason =
    reason === 'content-filter'
      ? 'content_filtered'
      : reason === 'tool-calls'
        ? 'tool_calls'
        : reason === 'stop' || reason === 'length' || reason === 'output_validation_failed'
          ? reason
          : 'other'
  return {
    modelId: call.model.id,
    providerId: call.model.provider.id,
    modelSlug: call.model.slug,
    providerType: call.model.provider.type,
    finishReason,
    durationMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))),
    toolCallCount: Math.min(2147483647, Math.max(0, tools)),
    usage: normalizeAiUsage(usage, usage.source),
  }
}
