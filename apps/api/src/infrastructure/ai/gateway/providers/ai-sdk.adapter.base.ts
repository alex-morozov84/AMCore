import { generateText, isStepCount, type LanguageModel, NoObjectGeneratedError, Output } from 'ai'
import type { ZodType } from 'zod'

import type { AiProviderType } from '../../../../generated/prisma/client.js'
import { AiGatewayException } from '../ai-gateway.error.js'
import type {
  AiAdapterCall,
  AiObjectResult,
  AiProviderAdapter,
  AiTextResult,
} from '../ai-gateway.types.js'
import {
  type AiProviderReceipt,
  attachProviderReceipt,
  observeProviderReceipt,
} from '../provider-receipt.js'

import {
  mapProviderError,
  mapTextResult,
  mapUsage,
  toModelMessages,
  toSdkTools,
} from './ai-sdk-mapping.js'

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

  protected readonly fetchImpl: AdapterFetch

  constructor(fetchImpl: AdapterFetch = globalThis.fetch) {
    this.fetchImpl = (input, init) => fetchImpl(input, { ...init, redirect: 'error' })
  }

  protected abstract resolveLanguageModel(call: AiAdapterCall): LanguageModel

  async generateText(call: AiAdapterCall): Promise<AiTextResult> {
    assertNotAborted(call)
    const started = performance.now()
    const signal = callSignal(call)
    let receipt: AiProviderReceipt | undefined
    const hasTools = call.tools !== undefined && call.tools.length > 0
    try {
      const result = await generateText({
        model: this.resolveLanguageModel(call),
        instructions: call.system,
        messages: toModelMessages(call.messages),
        // Tools are offered without an `execute`, and an explicit stop condition permits exactly
        // ONE step and returns the model's tool calls UNEXECUTED (Arc E invariant 1) — AMCore owns
        // the loop and host-side execution. `toolChoice: 'auto'` lets the model answer or call a tool.
        tools: hasTools ? toSdkTools(call.tools!) : undefined,
        toolChoice: hasTools ? 'auto' : undefined,
        maxOutputTokens: call.maxOutputTokens,
        abortSignal: signal,
        // The SDK must not retry: retry is Postgres-owned at the durable-run layer (Arc C,
        // ADR-052). Hidden SDK retries would double-count attempts and fight that schedule.
        maxRetries: 0,
        stopWhen: isStepCount(1),
      })
      receipt = observeProviderReceipt(
        call,
        mapUsage(result.finalStep.usage, call.model.provider.type),
        result.finishReason,
        started,
        result.toolCalls.length
      )
      assertCallActive(call, signal)
      return {
        ...mapTextResult(
          {
            text: result.text,
            finishReason: result.finishReason,
            toolCalls: result.toolCalls,
            usage: result.finalStep.usage,
          },
          call
        ),
        receipt,
      }
    } catch (error) {
      throw attachProviderReceipt(
        receipt?.finishReason === 'content_filtered' && !call.abortSignal?.aborted
          ? AiGatewayException.contentFiltered(call.model.provider.type)
          : mapAdapterError(error, call, signal),
        receipt
      )
    }
  }

  async generateObject<T>(
    call: AiAdapterCall,
    schema: ZodType<T>
  ): Promise<AiObjectResult<Exclude<T, null | undefined>>> {
    assertNotAborted(call)
    const started = performance.now()
    const signal = callSignal(call)
    let receipt: AiProviderReceipt | undefined
    try {
      const result = await generateText({
        model: this.resolveLanguageModel(call),
        output: Output.object({ schema }),
        instructions: call.system,
        messages: toModelMessages(call.messages),
        maxOutputTokens: call.maxOutputTokens,
        abortSignal: signal,
        maxRetries: 0,
        stopWhen: isStepCount(1),
        onStepEnd: (step) => {
          receipt = observeProviderReceipt(
            call,
            mapUsage(step.usage, call.model.provider.type),
            step.finishReason,
            started
          )
        },
      })
      receipt = observeProviderReceipt(
        call,
        mapUsage(result.finalStep.usage, call.model.provider.type),
        result.finishReason,
        started
      )
      assertCallActive(call, signal)
      if (receipt.finishReason === 'content_filtered')
        throw AiGatewayException.contentFiltered(call.model.provider.type)
      const object = result.output
      if (!hasStructuredValue(object))
        throw AiGatewayException.outputValidationFailed(call.model.provider.type)
      return {
        receipt,
        object,
        usage: mapUsage(result.finalStep.usage, call.model.provider.type),
        modelSlug: call.model.slug,
        providerType: call.model.provider.type,
      }
    } catch (error) {
      if (
        !receipt &&
        NoObjectGeneratedError.isInstance(error) &&
        (error.response !== undefined ||
          error.usage !== undefined ||
          error.finishReason !== undefined)
      ) {
        receipt = observeProviderReceipt(
          call,
          mapUsage(error.usage, call.model.provider.type),
          error.finishReason === 'content-filter' ? 'content-filter' : 'output_validation_failed',
          started
        )
      }
      throw attachProviderReceipt(
        receipt?.finishReason === 'content_filtered' && !call.abortSignal?.aborted
          ? AiGatewayException.contentFiltered(call.model.provider.type)
          : mapAdapterError(error, call, signal),
        receipt
      )
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
function mapAdapterError(
  error: unknown,
  call: AiAdapterCall,
  signal: AbortSignal
): AiGatewayException {
  if (call.abortSignal?.aborted === true)
    return AiGatewayException.aborted(call.model.provider.type)
  if (signal.aborted) return AiGatewayException.providerTimeout(call.model.provider.type)
  return mapProviderError(error, call.model.provider.type)
}

/** An already-aborted caller signal makes no provider request (the SDK does not check it up front). */
function assertNotAborted(call: AiAdapterCall): void {
  if (call.abortSignal?.aborted === true) {
    throw AiGatewayException.aborted(call.model.provider.type)
  }
}

/** Root nullish results are invalid; nullish object fields remain schema-owned. */
function hasStructuredValue<T>(value: T): value is Exclude<T, null | undefined> {
  return value !== null && value !== undefined
}

function assertCallActive(call: AiAdapterCall, signal: AbortSignal): void {
  assertNotAborted(call)
  if (signal.aborted) throw AiGatewayException.providerTimeout(call.model.provider.type)
}
