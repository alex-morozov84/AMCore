import { AiProviderType } from '@prisma/client'
import { z } from 'zod'

import type { AiAdapterCall } from '../ai-gateway.types'

import { AnthropicAdapter } from './anthropic.adapter'

/**
 * Anthropic adapter against a fake provider via an injected `fetch` (Track C — ADR-054, Arc B):
 * no network, no live key. Verifies the request shape (URL + `x-api-key`) and the mapping of a
 * canned Messages-API response to our `AiTextResult`, plus error normalization by HTTP status.
 */

interface CapturedRequest {
  url: string
  headers: Headers
}

function fakeFetch(
  body: unknown,
  status = 200
): typeof globalThis.fetch & { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch & { calls: CapturedRequest[] }
  fn.calls = calls
  return fn
}

function call(baseUrl: string | null = null): AiAdapterCall {
  return {
    model: {
      slug: 'claude-default',
      providerModelName: 'claude-opus-4-8',
      capabilities: { text: true },
      contextLimit: null,
      maxOutputTokens: null,
      isDefault: true,
      provider: {
        slug: 'anthropic',
        type: AiProviderType.ANTHROPIC,
        baseUrl,
        credentialSlot: 'default',
        dataRetentionClass: 'provider_default',
        config: null,
      },
    },
    credential: 'sk-aB0_-Zz9',
    messages: [{ role: 'user', content: 'hello' }],
    timeoutMs: 60000,
  }
}

const MESSAGES_RESPONSE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-4-8',
  content: [{ type: 'text', text: 'hi from claude' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
}

describe('AnthropicAdapter', () => {
  it('calls the Messages API with x-api-key and maps the result', async () => {
    const fetchImpl = fakeFetch(MESSAGES_RESPONSE)
    const adapter = new AnthropicAdapter(fetchImpl)

    const result = await adapter.generateText(call())

    expect(result.text).toBe('hi from claude')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    expect(result.providerType).toBe(AiProviderType.ANTHROPIC)
    expect(fetchImpl.calls[0]!.url).toContain('/messages')
    expect(fetchImpl.calls[0]!.headers.get('x-api-key')).toBe('sk-aB0_-Zz9')
  })

  it('ignores a malicious catalog baseUrl (base URL is code-owned)', async () => {
    const fetchImpl = fakeFetch(MESSAGES_RESPONSE)
    const adapter = new AnthropicAdapter(fetchImpl)

    await adapter.generateText(call('https://evil.example/v1'))

    expect(fetchImpl.calls[0]!.url).toContain('https://api.anthropic.com/v1/messages')
    expect(fetchImpl.calls[0]!.url).not.toContain('evil.example')
  })

  it('round-trips a tool call provider-agnostically: maps a tool_use block to toolCalls (Arc E)', async () => {
    const toolUse = {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'current_time', input: {} }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    const adapter = new AnthropicAdapter(fakeFetch(toolUse))

    const result = await adapter.generateText({
      ...call(),
      tools: [
        {
          name: 'current_time',
          description: 'Returns the time.',
          parameters: z.object({}).strict(),
        },
      ],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([
      { toolCallId: 'toolu_1', toolName: 'current_time', input: {} },
    ])
  })

  it('normalizes a 5xx to a retryable provider_unavailable', async () => {
    const adapter = new AnthropicAdapter(fakeFetch({ error: 'overloaded' }, 503))
    await expect(adapter.generateText(call())).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    })
  })

  it('normalizes a 4xx to a non-retryable provider_rejected', async () => {
    const adapter = new AnthropicAdapter(fakeFetch({ error: 'bad request' }, 400))
    await expect(adapter.generateText(call())).rejects.toMatchObject({
      code: 'provider_rejected',
      retryable: false,
    })
  })
})
