import { generateObject, generateText, type LanguageModel } from 'ai'
import type { ZodType } from 'zod'

import { AiGatewayException } from '../ai-gateway.error'
import type {
  AiAdapterCall,
  AiObjectResult,
  AiProviderAdapter,
  AiTextResult,
} from '../ai-gateway.types'

import {
  mapProviderError,
  mapTextResult,
  mapUsage,
  toModelMessages,
  toSdkTools,
} from './ai-sdk-mapping'

import type { AiProviderType } from '@/generated/prisma/client'

/** The fetch shape both the global and the AI SDK's injectable `fetch` option satisfy. */
export type AdapterFetch = typeof globalThis.fetch

/**
 * Shared base for the real Vercel AI SDK-backed adapters (Track C — ADR-054, Arc B). Owns the
 * common generateText flow — build the SDK language model, run a non-streaming call bounded by the
 * gateway timeout (`AbortSignal.timeout`), map the result, and normalize errors — so each concrete
 * adapter only resolves its provider's language model. A test-injectable `fetch` makes every
 * adapter deterministically testable against a fake provider with no network or live key. SDK
 * telemetry is left off (the default); no request/response is logged.
 */
export abstract class AbstractAiSdkAdapter implements AiProviderAdapter {
  abstract readonly supportedTypes: readonly AiProviderType[]

  constructor(protected readonly fetchImpl?: AdapterFetch) {}

  protected abstract resolveLanguageModel(call: AiAdapterCall): LanguageModel

  async generateText(call: AiAdapterCall): Promise<AiTextResult> {
    assertNotAborted(call)
    const hasTools = call.tools !== undefined && call.tools.length > 0
    try {
      const result = await generateText({
        model: this.resolveLanguageModel(call),
        system: call.system,
        messages: toModelMessages(call.messages),
        // Tools are offered without an `execute`, and no `stopWhen` is set, so the SDK does exactly
        // ONE step and returns the model's tool calls UNEXECUTED (Arc E invariant 1) — AMCore owns
        // the loop and host-side execution. `toolChoice: 'auto'` lets the model answer or call a tool.
        tools: hasTools ? toSdkTools(call.tools!) : undefined,
        toolChoice: hasTools ? 'auto' : undefined,
        maxOutputTokens: call.maxOutputTokens,
        abortSignal: callSignal(call),
        // The SDK must not retry: retry is Postgres-owned at the durable-run layer (Arc C,
        // ADR-052). Hidden SDK retries would double-count attempts and fight that schedule.
        maxRetries: 0,
      })
      return mapTextResult(result, call)
    } catch (error) {
      throw mapAdapterError(error, call)
    }
  }

  async generateObject<T>(call: AiAdapterCall, schema: ZodType<T>): Promise<AiObjectResult<T>> {
    assertNotAborted(call)
    try {
      const result = await generateObject({
        model: this.resolveLanguageModel(call),
        schema,
        system: call.system,
        messages: toModelMessages(call.messages),
        maxOutputTokens: call.maxOutputTokens,
        abortSignal: callSignal(call),
        maxRetries: 0,
      })
      return {
        object: result.object,
        usage: mapUsage(result.usage),
        modelSlug: call.model.slug,
        providerType: call.model.provider.type,
      }
    } catch (error) {
      throw mapAdapterError(error, call)
    }
  }
}

/** The call's abort signal: the per-call timeout merged with the caller-owned abort (if any). */
function callSignal(call: AiAdapterCall): AbortSignal {
  const timeout = AbortSignal.timeout(call.timeoutMs)
  return call.abortSignal ? AbortSignal.any([timeout, call.abortSignal]) : timeout
}

/**
 * Normalize an SDK failure. A caller abort (run deadline / shutdown) is surfaced as the
 * non-retryable `aborted` error — never as a provider timeout that an ordinary retry would repeat.
 */
function mapAdapterError(error: unknown, call: AiAdapterCall): AiGatewayException {
  if (call.abortSignal?.aborted === true)
    return AiGatewayException.aborted(call.model.provider.type)
  return mapProviderError(error, call.model.provider.type)
}

/** An already-aborted caller signal makes no provider request (the SDK does not check it up front). */
function assertNotAborted(call: AiAdapterCall): void {
  if (call.abortSignal?.aborted === true) {
    throw AiGatewayException.aborted(call.model.provider.type)
  }
}
