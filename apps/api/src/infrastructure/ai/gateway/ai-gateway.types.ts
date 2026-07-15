import type { AiProviderType } from '@prisma/client'
import type { ZodType } from 'zod'

import type { ResolvedAiModel } from '../registry/ai-registry.types'

/**
 * Gateway request/result contracts (Track C — ADR-054, Arc B). The cross-provider common
 * denominator: a trusted `system` instruction plus a turn list, normalized to a bounded text
 * result + usage. Multimodal content parts (Arc G) and structured output (B.4) extend this
 * additively. No secret rides these types; the credential is resolved inside the gateway.
 */

/**
 * A model-requested tool call the gateway surfaces (Track C — ADR-054, Arc E). It is **not** executed
 * here: the model only *requests* a call, and the worker loop validates the args against the tool's
 * schema and executes it host-side after persistence (invariant 1 — no SDK auto-execution).
 */
export interface AiToolCall {
  toolCallId: string
  toolName: string
  /** Raw model-produced arguments; the loop validates them against the tool's Zod schema (Arc E.4). */
  input: unknown
}

/** A tool result fed back to the model as an untrusted turn (text-only in Arc E; multimodal → Arc G). */
export interface AiToolResultPart {
  toolCallId: string
  toolName: string
  output: string
}

/**
 * One part of a multimodal user turn's content (Track C — ADR-054, Arc G). Mirrors the Vercel AI
 * SDK's own `TextPart | ImagePart | FilePart` shape so `toModelMessages` is a straight pass-through
 * mapping, not a re-derivation. Image/file bytes are always resolved server-side by the worker from
 * private storage and inlined here as a `Buffer` — never a URL, so a provider never fetches AMCore
 * storage directly (see `ai-run-executor.service.ts` artifact resolution).
 */
export type AiUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: Buffer; mediaType: string }
  | { type: 'file'; data: Buffer; mediaType: string; filename?: string }

/**
 * One conversation turn handed to the gateway. A discriminated union so the tool path (Arc E) and
 * the multimodal path (Arc G) are both additive over the Arc B text path: a plain text
 * `user`/`assistant` turn, a multimodal `user` turn, an `assistant` tool-call turn, or a `tool`
 * result turn. The provider-agnostic mapper converts these to the SDK's message parts — no
 * provider-specific block ever crosses this boundary.
 */
export type AiGenerateMessage =
  | { role: 'user'; content: string | AiUserContentPart[] }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; toolCalls: AiToolCall[] }
  | { role: 'tool'; toolResults: AiToolResultPart[] }

/**
 * A tool offered to the model for one generation step (Track C — ADR-054, Arc E). It carries **no**
 * `execute`: the model only requests a call; the worker loop executes it. `parameters` (a Zod schema)
 * is mapped to the provider's tool schema by the adapter. `name` is the code-owned tool id.
 */
export interface AiGatewayTool {
  name: string
  description: string
  parameters: ZodType<unknown>
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
  /** Tools offered to the model for this single step (Arc E). Absent → the Arc B pure-text path. */
  tools?: AiGatewayTool[]
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
export type AiFinishReason = 'stop' | 'length' | 'tool_calls' | 'other'

/** Normalized non-streaming text result. `toolCalls` is empty on a pure-text answer (Arc E). */
export interface AiTextResult {
  text: string
  finishReason: AiFinishReason
  toolCalls: AiToolCall[]
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
  /** Tools offered to the model for this step (Arc E); the adapter maps them to a provider schema. */
  tools?: AiGatewayTool[]
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
