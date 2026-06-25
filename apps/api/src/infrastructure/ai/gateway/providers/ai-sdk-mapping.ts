import type { AiProviderType } from '@prisma/client'
import {
  APICallError,
  type GenerateTextResult,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  TypeValidationError,
} from 'ai'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall, AiFinishReason, AiTextResult, AiUsage } from '../ai-gateway.types'

/**
 * Mapping helpers between the Vercel AI SDK and AMCore's own gateway contracts (Track C —
 * ADR-054, Arc B). The SDK is an implementation detail: its result/error/finish-reason types
 * never leak past this boundary — adapters return our `AiTextResult` and throw our bounded
 * `AiGatewayException`. No prompt/response content or credential is ever read into a log or error.
 */

function mapFinishReason(reason: string): AiFinishReason {
  if (reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  return 'other'
}

/** Normalize SDK token usage (any field may be undefined) into our bounded `AiUsage`. */
export function mapUsage(usage: LanguageModelUsage): AiUsage {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  return { inputTokens, outputTokens, totalTokens: usage.totalTokens ?? inputTokens + outputTokens }
}

/** Map a successful SDK text result; a provider safety refusal becomes a `content_filtered` error. */
export function mapTextResult(
  result: Pick<GenerateTextResult<never, never>, 'text' | 'finishReason' | 'usage'>,
  call: AiAdapterCall
): AiTextResult {
  const providerType = call.model.provider.type
  if (result.finishReason === 'content-filter') {
    throw AiGatewayException.contentFiltered(providerType)
  }
  return {
    text: result.text,
    finishReason: mapFinishReason(result.finishReason),
    usage: mapUsage(result.usage),
    modelSlug: call.model.slug,
    providerType,
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/**
 * Normalize any thrown error from a provider call into the bounded gateway taxonomy. The SDK's
 * `APICallError.isRetryable` carries the transient-vs-permanent classification (429/5xx vs 4xx).
 */
export function mapProviderError(error: unknown, providerType: AiProviderType): AiGatewayException {
  if (error instanceof AiGatewayException) return error
  if (isAbortError(error)) return AiGatewayException.providerTimeout(providerType)
  if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return AiGatewayException.outputValidationFailed(providerType)
  }
  if (APICallError.isInstance(error)) {
    return error.isRetryable
      ? AiGatewayException.providerUnavailable(providerType)
      : AiGatewayException.providerRejected(providerType)
  }
  return AiGatewayException.providerUnavailable(providerType)
}
