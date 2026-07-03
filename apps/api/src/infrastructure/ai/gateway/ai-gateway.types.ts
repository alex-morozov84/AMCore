import type { AiProviderType } from '@prisma/client'
import type { ZodType } from 'zod'

import type { ResolvedAiModel } from '../registry/ai-registry.types'

/**
 * Gateway request/result contracts (Track C — ADR-054, Arc B). The cross-provider common
 * denominator: a trusted `system` instruction plus a turn list, normalized to a bounded text
 * result + usage. Multimodal content parts (Arc G) and structured output (B.4) extend this
 * additively. No secret rides these types; the credential is resolved inside the gateway.
 */

/** A single conversation turn handed to the gateway (text-only in Arc B). */
export interface AiGenerateMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Optional accounting attribution for a generation. Every field is a snapshot id (no FK); the
 * usage ledger is a snapshot/no-FK accounting record. Arc B callers may pass none; Arc C passes
 * the run/conversation/principal context.
 */
export interface AiUsageContext {
  userId?: string
  organizationId?: string
  apiKeyId?: string
  runId?: string
  conversationId?: string
}

/** What a caller asks the gateway to generate. `modelSlug` omitted → the gated default model. */
export interface AiGenerateRequest {
  modelSlug?: string
  system?: string
  messages: AiGenerateMessage[]
  maxOutputTokens?: number
  context?: AiUsageContext
  /**
   * Whether the gateway records the best-effort `AiUsageLedger` row itself (default `true`, the
   * Arc B behavior). The Arc C durable executor sets this `false` and writes a run-attributed
   * ledger row **inside its finalization transaction** — so the authoritative usage row is
   * exactly-once by the same CAS as the run outcome, and a provider call whose finalize is rolled
   * back (recovery retries) does not leave an orphan ledger row. Metrics still count every call.
   */
  recordUsage?: boolean
}

/** Provider-reported (or estimated) token usage, normalized across adapters. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Why generation stopped (bounded; a provider refusal is surfaced as a `content_filtered` error). */
export type AiFinishReason = 'stop' | 'length' | 'other'

/** Normalized non-streaming text result. */
export interface AiTextResult {
  text: string
  finishReason: AiFinishReason
  usage: AiUsage
  modelSlug: string
  providerType: AiProviderType
}

/** Normalized structured-output result — `object` is validated against the caller's schema. */
export interface AiObjectResult<T> {
  object: T
  usage: AiUsage
  modelSlug: string
  providerType: AiProviderType
}

/** The concrete per-provider call an adapter receives (credential injected by the gateway). */
export interface AiAdapterCall {
  model: ResolvedAiModel
  credential: string | null
  system?: string
  messages: AiGenerateMessage[]
  maxOutputTokens?: number
  timeoutMs: number
}

/**
 * One provider-family adapter. An adapter may serve several provider types (e.g. the
 * OpenAI-compatible adapter backs OpenAI, OpenRouter, Yandex, and any compatible endpoint),
 * so it declares `supportedTypes`; the gateway maps each type to its adapter. `generateObject`
 * is optional: only SDK-backed adapters support structured output, and the gateway gates on the
 * model's declared capability before dispatch (the key-less mock does not implement it).
 */
export interface AiProviderAdapter {
  readonly supportedTypes: readonly AiProviderType[]
  generateText(call: AiAdapterCall): Promise<AiTextResult>
  generateObject?<T>(call: AiAdapterCall, schema: ZodType<T>): Promise<AiObjectResult<T>>
}

/** DI token for the list of registered provider adapters the gateway dispatches across. */
export const AI_PROVIDER_ADAPTERS = 'AI_PROVIDER_ADAPTERS'
