import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { ZodType } from 'zod'

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
    const { model, adapter, call } = await this.prepare(request)
    try {
      const result = await adapter.generateText(call)
      await this.settle(model, 'text', result.usage, request)
      return result
    } catch (error) {
      this.recordFailure(model, 'text')
      throw this.normalizeError(error, model)
    }
  }

  async generateObject<T>(
    request: AiGenerateRequest,
    schema: ZodType<T>
  ): Promise<AiObjectResult<T>> {
    const { model, adapter, call } = await this.prepare(request)
    if (model.capabilities.structured_output !== true || adapter.generateObject === undefined) {
      throw AiGatewayException.capabilityUnsupported(model.slug, 'structured_output')
    }
    try {
      const result = await adapter.generateObject(call, schema)
      await this.settle(model, 'object', result.usage, request)
      return result
    } catch (error) {
      this.recordFailure(model, 'object')
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
    this.metrics.incAiTokens(provider, 'input', usage.inputTokens)
    this.metrics.incAiTokens(provider, 'output', usage.outputTokens)
    if (request.recordUsage === false) return
    await this.usageLedger.record({ modelSlug: model.slug, usage, context: request.context })
  }

  private recordFailure(model: ResolvedAiModel, operation: AiMetricsOperation): void {
    this.metrics.incAiGeneration(providerLabel(model), operation, 'error')
  }

  private async prepare(
    request: AiGenerateRequest
  ): Promise<{ model: ResolvedAiModel; adapter: AiProviderAdapter; call: AiAdapterCall }> {
    const model = await this.resolveModel(request.modelSlug)
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
    const call: AiAdapterCall = {
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
    }
    return { model, adapter, call }
  }

  private async resolveModel(slug: string | undefined): Promise<ResolvedAiModel> {
    if (slug !== undefined) {
      const model = await this.registry.resolveModel(slug)
      if (model === null) throw AiGatewayException.modelNotFound(slug)
      return model
    }
    const model = await this.registry.resolveDefaultModel()
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
