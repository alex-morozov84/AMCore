import { HttpStatus } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { ZodType } from 'zod'

import { endpointBinding, freezeAiModel } from '../registry/ai-execution-descriptor'
import { AiModelRegistry } from '../registry/ai-model-registry.service'
import type { ResolvedAiModel } from '../registry/ai-registry.types'
import { AiUsageLedgerService } from '../usage/ai-usage-ledger.service'

import { AiGatewayException } from './ai-gateway.error'
import {
  AI_PROVIDER_ADAPTERS,
  type AiAdapterCall,
  type AiGenerateRequest,
  type AiObjectResult,
  type AiProviderAdapter,
  type AiTextResult,
  type AiUsage,
} from './ai-gateway.types'
import { AiCredentialResolver } from './credential-resolver'
import { findUnsupportedMultimodalCapability } from './multimodal-capability'
import { providerReceipt } from './provider-receipt'

import { EnvService } from '@/env/env.service'
import {
  type AiMetricsOperation,
  type AiMetricsProvider,
  MetricsService,
} from '@/infrastructure/observability'

/** Low-cardinality metric label: the lowercase wire form of the catalog provider type. */
function providerLabel(model: ResolvedAiModel): AiMetricsProvider {
  return model.provider.type.toLowerCase() as AiMetricsProvider
}

/**
 * The AMCore `ModelGateway` seam (Track C — ADR-054, Arc B). Resolves a model (an explicit slug or
 * the gated default), enforces the credential gate **centrally** (a key-less model is a clean
 * `model_not_configured` error, not a provider crash), dispatches to the provider-family adapter,
 * records usage + content-free metrics, and normalizes every failure into the bounded
 * `AiGatewayException` taxonomy. `generateObject` adds capability-gated structured output.
 */
@Injectable()
export class ModelGateway {
  private readonly adapters: Map<string, AiProviderAdapter>

  constructor(
    @Inject(AI_PROVIDER_ADAPTERS) adapters: AiProviderAdapter[],
    private readonly registry: AiModelRegistry,
    private readonly credentials: AiCredentialResolver,
    private readonly env: EnvService,
    private readonly logger: PinoLogger,
    private readonly usageLedger: AiUsageLedgerService,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(ModelGateway.name)
    this.adapters = new Map()
    for (const adapter of adapters) {
      for (const type of adapter.supportedTypes) {
        if (this.adapters.has(type)) {
          // Fail fast at startup: a second adapter claiming the same provider type would
          // otherwise silently shadow the first in the dispatch map.
          throw new Error(`Duplicate AI provider adapter registered for type "${type}"`)
        }
        this.adapters.set(type, adapter)
      }
    }
  }

  async generateText(request: AiGenerateRequest): Promise<AiTextResult> {
    const { model, adapter } = await this.prepare(request)
    await request.beforeDispatch?.()
    const call = this.adapterCall(model, request)
    // Preparation itself yields: the caller may abort before this continuation dispatches.
    if (request.abortSignal?.aborted === true) throw AiGatewayException.aborted(model.provider.type)
    try {
      const result = await adapter.generateText(call)
      await this.settle(model, 'text', result.usage, request)
      return result
    } catch (error) {
      await this.settleFailureReceipt(model, 'text', error, request)
      throw this.normalizeError(error, model)
    }
  }

  async generateObject<T>(
    request: AiGenerateRequest,
    schema: ZodType<T>
  ): Promise<AiObjectResult<T>> {
    const { model, adapter } = await this.prepare(request)
    if (request.abortSignal?.aborted === true) throw AiGatewayException.aborted(model.provider.type)
    if (model.capabilities.structured_output !== true || adapter.generateObject === undefined) {
      throw AiGatewayException.capabilityUnsupported(model.slug, 'structured_output')
    }
    await request.beforeDispatch?.()
    const call = this.adapterCall(model, request)
    try {
      const result = await adapter.generateObject(call, schema)
      await this.settle(model, 'object', result.usage, request)
      return result
    } catch (error) {
      await this.settleFailureReceipt(model, 'object', error, request)
      throw this.normalizeError(error, model)
    }
  }

  /**
   * Record success metrics after a generation, and the best-effort usage ledger row **unless** the
   * caller opted out (`recordUsage: false`) to own the durable write itself (Arc C executor).
   * Accounting never breaks the result; metrics always count every provider call.
   */
  private async settle(
    model: ResolvedAiModel,
    operation: AiMetricsOperation,
    usage: AiUsage,
    request: AiGenerateRequest
  ): Promise<void> {
    const provider = providerLabel(model)
    this.metrics.incAiGeneration(provider, operation, 'success')
    if (usage.inputTokens !== null) this.metrics.incAiTokens(provider, 'input', usage.inputTokens)
    if (usage.outputTokens !== null)
      this.metrics.incAiTokens(provider, 'output', usage.outputTokens)
    if (request.recordUsage === false) return
    await this.usageLedger.record({ modelSlug: model.slug, usage, context: request.context })
  }

  private async settleFailureReceipt(
    model: ResolvedAiModel,
    operation: AiMetricsOperation,
    error: unknown,
    request: AiGenerateRequest
  ): Promise<void> {
    this.recordFailure(model, operation)
    const receipt = providerReceipt(error)
    if (!receipt) return
    if (receipt.usage.inputTokens !== null)
      this.metrics.incAiTokens(providerLabel(model), 'input', receipt.usage.inputTokens)
    if (receipt.usage.outputTokens !== null)
      this.metrics.incAiTokens(providerLabel(model), 'output', receipt.usage.outputTokens)
    if (request.recordUsage !== false)
      await this.usageLedger.record({
        modelSlug: model.slug,
        usage: receipt.usage,
        context: request.context,
      })
  }

  private recordFailure(model: ResolvedAiModel, operation: AiMetricsOperation): void {
    this.metrics.incAiGeneration(providerLabel(model), operation, 'error')
  }

  private async prepare(
    request: AiGenerateRequest
  ): Promise<{ model: ResolvedAiModel; adapter: AiProviderAdapter }> {
    const resolved = request.execution
      ? null
      : await this.resolveModel(request.modelSlug, request.abortSignal)
    let selected
    try {
      selected = request.execution ?? freezeAiModel(resolved!)
    } catch {
      throw AiGatewayException.modelNotConfigured(resolved!.slug)
    }
    const live = await this.registry.resolveLiveModel(
      selected.modelId,
      request.abortSignal,
      selected
    )
    let matches = false
    try {
      const endpoint = live ? endpointBinding(live) : null
      matches =
        !!live &&
        live.provider.id === selected.providerId &&
        live.provider.type === selected.providerType &&
        live.provider.credentialSlot === selected.credentialSlot &&
        endpoint?.kind === selected.endpoint.kind &&
        (endpoint.kind === 'built_in' ||
          (selected.endpoint.kind === 'compatible' && endpoint.sha256 === selected.endpoint.sha256))
    } catch {
      /* malformed live endpoint refuses binding */
    }
    if (!live || !matches)
      throw new AiGatewayException(
        'model_binding_changed',
        HttpStatus.SERVICE_UNAVAILABLE,
        false,
        'AI model binding changed'
      )
    const model: ResolvedAiModel = {
      ...live,
      slug: selected.modelSlug,
      providerModelName: selected.providerModelName,
      capabilities: selected.capabilities,
      contextLimit: selected.contextLimit,
      maxOutputTokens: selected.maxOutputTokens,
      provider: { ...live.provider, slug: selected.providerSlug },
    }
    // The catalog read may have resumed after the caller's cutoff: start no transport then.
    if (request.abortSignal?.aborted === true) {
      throw AiGatewayException.aborted(model.provider.type)
    }
    // Central gate (B.2 follow-up): a key-less model or a type with no adapter is not configured.
    const adapter = this.adapters.get(model.provider.type)
    if (!this.registry.hasCredential(model) || adapter === undefined) {
      throw AiGatewayException.modelNotConfigured(model.slug)
    }
    // Central multimodal capability gate (Arc G): the correctness boundary for any caller,
    // mirroring the generateObject structured_output gate below.
    const unsupported = findUnsupportedMultimodalCapability(model, request.messages)
    if (unsupported !== null) {
      throw AiGatewayException.capabilityUnsupported(model.slug, unsupported)
    }
    return { model, adapter }
  }

  private adapterCall(model: ResolvedAiModel, request: AiGenerateRequest): AiAdapterCall {
    if (request.abortSignal?.aborted === true) throw AiGatewayException.aborted(model.provider.type)
    return {
      model,
      credential: this.credentials.getCredential(
        model.provider.type,
        model.provider.credentialSlot
      ),
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      maxOutputTokens: request.maxOutputTokens ?? model.maxOutputTokens ?? undefined,
      timeoutMs: this.env.get('AI_REQUEST_TIMEOUT_MS'),
      abortSignal: request.abortSignal,
    }
  }

  private async resolveModel(
    slug: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<ResolvedAiModel> {
    try {
      return await this.lookupModel(slug, signal)
    } catch (error) {
      // The caller's attempt boundary fired during the catalog read: not a provider fault.
      if (signal?.aborted === true && !(error instanceof AiGatewayException)) {
        throw AiGatewayException.aborted()
      }
      throw error
    }
  }

  private async lookupModel(
    slug: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<ResolvedAiModel> {
    if (slug !== undefined) {
      const model = await this.registry.resolveModel(slug, signal)
      if (model === null) throw AiGatewayException.modelNotFound(slug)
      return model
    }
    const model = await this.registry.resolveDefaultModel(signal)
    if (model === null) throw AiGatewayException.noDefaultModel()
    return model
  }

  private normalizeError(error: unknown, model: ResolvedAiModel): AiGatewayException {
    if (error instanceof AiGatewayException) return error
    // Never log prompt/response content or the credential — only the provider type + model slug.
    this.logger.warn(
      { providerType: model.provider.type, modelSlug: model.slug },
      'AI provider call failed; normalized to provider_unavailable'
    )
    return AiGatewayException.providerUnavailable(model.provider.type)
  }
}
