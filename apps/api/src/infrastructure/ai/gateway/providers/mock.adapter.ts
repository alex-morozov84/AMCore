import { Injectable } from '@nestjs/common'

import { AiGatewayException } from '../ai-gateway.error'
import type {
  AiAdapterCall,
  AiGatewayTool,
  AiGenerateMessage,
  AiProviderAdapter,
  AiTextResult,
  AiToolCall,
  AiUsage,
  AiUserContentPart,
} from '../ai-gateway.types'

import { AiProviderType } from '@/generated/prisma/client'

/** Rough deterministic token estimate (~4 chars/token) for the key-less mock. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** A plain-text view of any turn, for the mock's token estimate only (never a real transcript). */
function messageText(message: AiGenerateMessage): string {
  if (message.role === 'tool') return message.toolResults.map((result) => result.output).join(' ')
  if ('toolCalls' in message) return message.toolCalls.map((call) => call.toolName).join(' ')
  return contentText(message.content)
}

/**
 * Flatten a user turn's content to plain text (Arc G). The mock never declares `vision`/`pdf`, so
 * the gateway's central capability gate keeps a multimodal turn from reaching it in practice —
 * this only makes the mock defensively correct (image/file parts are invisible to a text-only
 * provider, exactly as a real text-only model would behave if it ignored non-text parts).
 */
function contentText(content: string | AiUserContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is Extract<AiUserContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
}

/**
 * Read the user's actual content from a turn. A real model responds to the user's message, not to
 * the Arc D trust-boundary wrapper, so when the content is the salted `<amcore:user-data-N>` JSON
 * envelope the mock extracts the inner `text` (else it returns the raw content unchanged). This
 * keeps the mock a faithful dev/test provider whose output does NOT echo the boundary marker — so it
 * never trips the output guard on an ordinary run.
 */
function readUserContent(raw: string): string {
  const match = raw.match(/^<(amcore:user-data-[^>\n]+)>\n([\s\S]*)\n<\/\1>$/)
  if (!match) return raw
  try {
    const parsed = JSON.parse(match[2]!) as { text?: unknown }
    return typeof parsed.text === 'string' ? parsed.text : raw
  } catch {
    return raw
  }
}

/**
 * Deterministic, key-less mock provider adapter (Track C — ADR-054, Arc B; tool script in Arc E).
 * Mirrors the email Mock provider: the engine works out of the box without credentials and tests get
 * a stable output. It performs NO network I/O and answers the user's inner content. Sentinel inputs
 * let tests exercise the runtime without a real provider: `__mock_error__` (raw failure →
 * `provider_unavailable`), `__mock_refusal__` (safety refusal → `content_filtered`), `__mock_leak__`
 * (boundary-marker output → Arc D output guard blocks it). Tool script (Arc E): with tools offered,
 * `__mock_tool__:<name>` requests one call and `__mock_tools__:<a>,<b>` requests several; once a tool
 * result turn is in the transcript the mock produces a final text answer citing the outputs.
 */
@Injectable()
export class MockAiAdapter implements AiProviderAdapter {
  readonly supportedTypes = [AiProviderType.MOCK] as const

  async generateText(call: AiAdapterCall): Promise<AiTextResult> {
    const last = call.messages[call.messages.length - 1]
    // A tool result just came back → the loop is resuming; answer with the tool outputs. Read the
    // INNER content of each result (a real model reads the data, it does NOT echo the Arc D untrusted
    // boundary wrapper) — so the mock answer never carries the marker and never trips the output guard.
    if (last?.role === 'tool') {
      const joined = last.toolResults.map((result) => readUserContent(result.output)).join(' | ')
      return this.textResult(call, `[mock:${call.model.providerModelName}] tool result: ${joined}`)
    }

    const lastUserMessage = [...call.messages].reverse().find((message) => message.role === 'user')
    const rawLastUser = lastUserMessage ? contentText(lastUserMessage.content) : ''
    const userContent = readUserContent(rawLastUser)

    if (userContent.includes('__mock_error__')) throw new Error('mock adapter forced failure')
    if (userContent.includes('__mock_refusal__')) {
      throw AiGatewayException.contentFiltered(call.model.provider.type)
    }

    const toolCalls = scriptToolCalls(userContent, call.tools ?? [])
    if (toolCalls.length > 0) return this.toolCallResult(call, toolCalls)

    let text = `[mock:${call.model.providerModelName}] ${userContent}`.trim()
    // Simulate a model that leaks the boundary marker into its output (Arc D output-guard test hook).
    if (userContent.includes('__mock_leak__')) text = `${text} amcore:user-data-leaked`
    return this.textResult(call, text)
  }

  private textResult(call: AiAdapterCall, text: string): AiTextResult {
    return {
      text: text.trim(),
      finishReason: 'stop',
      toolCalls: [],
      usage: usageFor(call, text),
      modelSlug: call.model.slug,
      providerType: call.model.provider.type,
    }
  }

  private toolCallResult(call: AiAdapterCall, toolCalls: AiToolCall[]): AiTextResult {
    return {
      text: '',
      finishReason: 'tool_calls',
      toolCalls,
      usage: usageFor(call, ''),
      modelSlug: call.model.slug,
      providerType: call.model.provider.type,
    }
  }
}

/** Emit tool calls named by a sentinel, restricted to the tools actually offered (never invented). */
function scriptToolCalls(userContent: string, tools: AiGatewayTool[]): AiToolCall[] {
  const offered = new Set(tools.map((toolDescriptor) => toolDescriptor.name))
  const multi = userContent.match(/__mock_tools__:([a-z0-9_,]+)/)
  if (multi) {
    return multi[1]!
      .split(',')
      .filter((name) => offered.has(name))
      .map((name, index) => ({ toolCallId: `mock-call-${index + 1}`, toolName: name, input: {} }))
  }
  const single = userContent.match(/__mock_tool__:([a-z0-9_]+)/)
  if (single && offered.has(single[1]!)) {
    return [{ toolCallId: 'mock-call-1', toolName: single[1]!, input: {} }]
  }
  return []
}

function usageFor(call: AiAdapterCall, outputText: string): AiUsage {
  const inputTokens =
    call.messages.reduce((sum, message) => sum + estimateTokens(messageText(message)), 0) +
    estimateTokens(call.system ?? '')
  const outputTokens = estimateTokens(outputText)
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
}
