import { z } from 'zod'

import type { AiAdapterCall } from '../ai-gateway.types'

import { OpenAICompatibleAdapter } from './openai-compatible.adapter'

import { AiProviderType } from '@/generated/prisma/client'

/**
 * OpenAI-compatible adapter against a fake provider via an injected `fetch` (Track C — ADR-054,
 * Arc B). Verifies per-family base URL + auth scheme are code-owned: OpenAI uses `Bearer`, Yandex
 * uses `Api-Key` at the Yandex base URL with the `gpt://…` model id passed through, and the generic
 * compatible type needs a catalog base URL.
 */

interface CapturedRequest {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

function fakeFetch(
  body: unknown,
  status = 200
): typeof globalThis.fetch & { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch & { calls: CapturedRequest[] }
  fn.calls = calls
  return fn
}

function call(
  type: AiProviderType,
  providerModelName: string,
  baseUrl: string | null = null,
  capabilities: Record<string, boolean> = { text: true }
): AiAdapterCall {
  return {
    model: {
      slug: 'm',
      providerModelName,
      capabilities,
      contextLimit: null,
      maxOutputTokens: null,
      isDefault: false,
      provider: {
        slug: 'p',
        type,
        baseUrl,
        credentialSlot: 'default',
        dataRetentionClass: 'provider_default',
        config: null,
      },
    },
    credential: 'sk-aB0_-Zz9',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 60000,
  }
}

function completion(content: string) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  }
}

describe('OpenAICompatibleAdapter', () => {
  it('uses Bearer auth at the OpenAI base URL', async () => {
    const fetchImpl = fakeFetch(completion('hi from gpt'))
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    const result = await adapter.generateText(call(AiProviderType.OPENAI, 'gpt-4o'))

    expect(result.text).toBe('hi from gpt')
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 4, totalTokens: 12 })
    expect(fetchImpl.calls[0]!.url).toContain('https://api.openai.com/v1/chat/completions')
    expect(fetchImpl.calls[0]!.headers.get('authorization')).toBe('Bearer sk-aB0_-Zz9')
  })

  it('uses Api-Key auth and the Yandex base URL, passing the gpt:// model id through', async () => {
    const fetchImpl = fakeFetch(completion('privet'))
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    await adapter.generateText(
      call(AiProviderType.YANDEX_AI_STUDIO, 'gpt://folder123/yandexgpt/latest')
    )

    expect(fetchImpl.calls[0]!.url).toContain(
      'https://llm.api.cloud.yandex.net/v1/chat/completions'
    )
    expect(fetchImpl.calls[0]!.headers.get('authorization')).toBe('Api-Key sk-aB0_-Zz9')
    expect(String(fetchImpl.calls[0]!.headers.get('authorization'))).not.toContain('Bearer')
  })

  it('ignores a malicious catalog baseUrl for OpenAI (named family is code-owned)', async () => {
    const fetchImpl = fakeFetch(completion('x'))
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    await adapter.generateText(call(AiProviderType.OPENAI, 'gpt-4o', 'https://evil.example/v1'))

    expect(fetchImpl.calls[0]!.url).toContain('https://api.openai.com/v1/chat/completions')
    expect(fetchImpl.calls[0]!.url).not.toContain('evil.example')
  })

  it('ignores a malicious catalog baseUrl for Yandex (credential cannot be redirected)', async () => {
    const fetchImpl = fakeFetch(completion('x'))
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    await adapter.generateText(
      call(AiProviderType.YANDEX_AI_STUDIO, 'gpt://f/yandexgpt/latest', 'https://evil.example/v1')
    )

    expect(fetchImpl.calls[0]!.url).toContain('https://llm.api.cloud.yandex.net/v1')
    expect(fetchImpl.calls[0]!.url).not.toContain('evil.example')
  })

  it('honors a catalog base URL override for the generic compatible type', async () => {
    const fetchImpl = fakeFetch(completion('local'))
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    await adapter.generateText(
      call(AiProviderType.OPENAI_COMPATIBLE, 'local-model', 'https://endpoint.example/v1')
    )

    expect(fetchImpl.calls[0]!.url).toContain('https://endpoint.example/v1/chat/completions')
  })

  it('generates a structured object and sends a json_schema response_format', async () => {
    const objectCompletion = {
      id: 'chatcmpl-2',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '{"answer":"42"}' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 },
    }
    const fetchImpl = fakeFetch(objectCompletion)
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    const result = await adapter.generateObject(
      // structured_output capability → provider-side json_schema, not degraded json_object.
      call(AiProviderType.OPENAI, 'gpt-4o', null, { text: true, structured_output: true }),
      z.object({ answer: z.string() })
    )

    expect(result.object).toEqual({ answer: '42' })
    expect(result.usage).toEqual({ inputTokens: 6, outputTokens: 3, totalTokens: 9 })
    const responseFormat = fetchImpl.calls[0]!.body.response_format as { type: string }
    expect(responseFormat.type).toBe('json_schema')
  })

  it('round-trips a tool call provider-agnostically and sends the tool schema (Arc E)', async () => {
    const toolCompletion = {
      id: 'chatcmpl-3',
      object: 'chat.completion',
      created: 0,
      model: 'm',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'current_time', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }
    const fetchImpl = fakeFetch(toolCompletion)
    const adapter = new OpenAICompatibleAdapter(fetchImpl)

    const result = await adapter.generateText({
      ...call(AiProviderType.OPENAI, 'gpt-4o'),
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
      { toolCallId: 'call_1', toolName: 'current_time', input: {} },
    ])
    const sentTools = fetchImpl.calls[0]!.body.tools as Array<{ function: { name: string } }>
    expect(sentTools.map((sent) => sent.function.name)).toEqual(['current_time'])
  })

  it('rejects a generic compatible model with no base URL as model_not_configured', async () => {
    const adapter = new OpenAICompatibleAdapter(fakeFetch(completion('x')))
    await expect(
      adapter.generateText(call(AiProviderType.OPENAI_COMPATIBLE, 'local-model', null))
    ).rejects.toMatchObject({ code: 'model_not_configured' })
  })
})
