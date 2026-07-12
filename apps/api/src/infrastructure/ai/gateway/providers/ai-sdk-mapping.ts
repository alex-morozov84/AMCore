import type { AiProviderType } from '@prisma/client'
import {
  APICallError,
  type FilePart,
  type ImagePart,
  type LanguageModelUsage,
  type ModelMessage,
  NoObjectGeneratedError,
  type TextPart,
  tool,
  type ToolSet,
  TypeValidationError,
} from 'ai'

import { AiGatewayException } from '../ai-gateway.error'
import type {
  AiAdapterCall,
  AiFinishReason,
  AiGatewayTool,
  AiGenerateMessage,
  AiTextResult,
  AiToolCall,
  AiUsage,
  AiUserContentPart,
} from '../ai-gateway.types'

/**
 * Mapping helpers between the Vercel AI SDK and AMCore's own gateway contracts (Track C —
 * ADR-054, Arc B; tool calling added in Arc E). The SDK is an implementation detail: its
 * result/error/message types never leak past this boundary — adapters speak AMCore's
 * `AiGenerateMessage`/`AiTextResult` and throw our bounded `AiGatewayException`. The tool mapping is
 * provider-agnostic: tools and tool-call/tool-result turns are expressed in the SDK's neutral
 * message parts, never a provider-specific block. No prompt/response content or credential is logged.
 */

function mapFinishReason(reason: string): AiFinishReason {
  if (reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  if (reason === 'tool-calls') return 'tool_calls'
  return 'other'
}

/** Normalize SDK token usage (any field may be undefined) into our bounded `AiUsage`. */
export function mapUsage(usage: LanguageModelUsage): AiUsage {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  return { inputTokens, outputTokens, totalTokens: usage.totalTokens ?? inputTokens + outputTokens }
}

/** A structural view of one SDK tool call — the fields we normalize (SDK adds provider extras). */
interface RawToolCall {
  toolCallId: string
  toolName: string
  input: unknown
}

/** Normalize the SDK's typed tool calls into our bounded, provider-agnostic `AiToolCall[]`. */
export function mapToolCalls(calls: readonly RawToolCall[] | undefined): AiToolCall[] {
  if (calls === undefined) return []
  return calls.map((call) => ({
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
  }))
}

/** Map a successful SDK text result; a provider safety refusal becomes a `content_filtered` error. */
export function mapTextResult(
  result: {
    text: string
    finishReason: string
    usage: LanguageModelUsage
    toolCalls?: readonly RawToolCall[]
  },
  call: AiAdapterCall
): AiTextResult {
  const providerType = call.model.provider.type
  if (result.finishReason === 'content-filter') {
    throw AiGatewayException.contentFiltered(providerType)
  }
  return {
    text: result.text,
    finishReason: mapFinishReason(result.finishReason),
    toolCalls: mapToolCalls(result.toolCalls),
    usage: mapUsage(result.usage),
    modelSlug: call.model.slug,
    providerType,
  }
}

/**
 * Convert AMCore's provider-agnostic turns into SDK `ModelMessage`s. A user/assistant text turn maps
 * to a plain message; a multimodal user turn (Arc G) maps its parts 1:1 to the SDK's neutral
 * `TextPart | ImagePart | FilePart` array; an assistant tool-call turn maps to `tool-call` content
 * parts; a tool-result turn maps to a `tool` message with `tool-result` parts whose text output is
 * sent as `{ type: 'text' }`. This is the only place tool/multimodal turns take SDK shape — kept
 * neutral across providers.
 */
export function toModelMessages(messages: AiGenerateMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === 'user') {
      return {
        role: 'user',
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map(toSdkUserPart),
      }
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.toolResults.map((result) => ({
          type: 'tool-result',
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          output: { type: 'text', value: result.output },
        })),
      }
    }
    if ('toolCalls' in message) {
      return {
        role: 'assistant',
        content: message.toolCalls.map((call) => ({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
      }
    }
    return { role: 'assistant', content: message.content }
  })
}

/**
 * Map one Arc G multimodal content part to the SDK's neutral `TextPart | ImagePart | FilePart`.
 * `image`/`file` data is always the worker-resolved `Buffer` (never a URL) — see
 * `AiUserContentPart`.
 */
function toSdkUserPart(part: AiUserContentPart): TextPart | ImagePart | FilePart {
  if (part.type === 'text') return { type: 'text', text: part.text }
  if (part.type === 'image') return { type: 'image', image: part.data, mediaType: part.mediaType }
  return { type: 'file', data: part.data, mediaType: part.mediaType, filename: part.filename }
}

/**
 * Build the SDK `ToolSet` for one step from AMCore tool descriptors. Each tool is registered with its
 * description + Zod input schema and **no `execute`** — so the SDK returns the model's tool calls
 * unexecuted (invariant 1); the worker loop validates and runs them host-side.
 */
export function toSdkTools(tools: AiGatewayTool[]): ToolSet {
  const set: ToolSet = {}
  for (const descriptor of tools) {
    set[descriptor.name] = tool({
      description: descriptor.description,
      inputSchema: descriptor.parameters,
    })
  }
  return set
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
