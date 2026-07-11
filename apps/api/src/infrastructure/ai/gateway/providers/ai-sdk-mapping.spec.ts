import { AiProviderType } from '@prisma/client'
import { APICallError, NoObjectGeneratedError } from 'ai'
import { z } from 'zod'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall, AiGatewayTool } from '../ai-gateway.types'

import { mapProviderError, mapTextResult, toModelMessages, toSdkTools } from './ai-sdk-mapping'

function call(type: AiProviderType = AiProviderType.OPENAI): AiAdapterCall {
  return {
    model: {
      slug: 's',
      providerModelName: 'pm',
      capabilities: { text: true },
      contextLimit: null,
      maxOutputTokens: null,
      isDefault: false,
      provider: {
        slug: 'p',
        type,
        baseUrl: null,
        credentialSlot: 'default',
        dataRetentionClass: 'provider_default',
        config: null,
      },
    },
    credential: 'k',
    messages: [{ role: 'user', content: 'x' }],
    timeoutMs: 60000,
  }
}

function result(finishReason: string) {
  return { text: 'out', finishReason, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
}

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: 'boom',
    url: 'https://x/v1',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  })
}

describe('mapTextResult', () => {
  it('maps a normal stop result with usage', () => {
    const mapped = mapTextResult(result('stop') as never, call())
    expect(mapped).toMatchObject({
      text: 'out',
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      providerType: AiProviderType.OPENAI,
    })
  })

  it('maps length and collapses unknown reasons to other', () => {
    expect(mapTextResult(result('length') as never, call()).finishReason).toBe('length')
    expect(mapTextResult(result('some-future-reason') as never, call()).finishReason).toBe('other')
  })

  it('maps the tool-calls finish reason and surfaces the calls (Arc E)', () => {
    const mapped = mapTextResult(
      {
        ...result('tool-calls'),
        toolCalls: [{ toolCallId: 'c1', toolName: 'current_time', input: { x: 1 } }],
      } as never,
      call()
    )
    expect(mapped.finishReason).toBe('tool_calls')
    expect(mapped.toolCalls).toEqual([
      { toolCallId: 'c1', toolName: 'current_time', input: { x: 1 } },
    ])
  })

  it('defaults toolCalls to an empty array on a plain text answer', () => {
    expect(mapTextResult(result('stop') as never, call()).toolCalls).toEqual([])
  })

  it('throws content_filtered on a provider safety refusal', () => {
    let caught: unknown
    try {
      mapTextResult(result('content-filter') as never, call())
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AiGatewayException)
    expect((caught as AiGatewayException).code).toBe('content_filtered')
  })
})

describe('mapProviderError', () => {
  it('maps an abort/timeout error to provider_timeout', () => {
    const abort = new Error('aborted')
    abort.name = 'TimeoutError'
    expect(mapProviderError(abort, AiProviderType.ANTHROPIC).code).toBe('provider_timeout')
  })

  it('maps a retryable APICallError to provider_unavailable', () => {
    const mapped = mapProviderError(apiError(503, true), AiProviderType.OPENAI)
    expect(mapped).toMatchObject({ code: 'provider_unavailable', retryable: true })
  })

  it('maps a non-retryable APICallError to provider_rejected', () => {
    const mapped = mapProviderError(apiError(400, false), AiProviderType.OPENAI)
    expect(mapped).toMatchObject({ code: 'provider_rejected', retryable: false })
  })

  it('passes an existing AiGatewayException through unchanged', () => {
    const original = AiGatewayException.contentFiltered(AiProviderType.OPENAI)
    expect(mapProviderError(original, AiProviderType.OPENAI)).toBe(original)
  })

  it('treats an unknown error as provider_unavailable (conservative)', () => {
    expect(mapProviderError(new Error('weird'), AiProviderType.MOCK).code).toBe(
      'provider_unavailable'
    )
  })

  it('maps a NoObjectGeneratedError to output_validation_failed', () => {
    const error = new NoObjectGeneratedError({
      message: 'no object',
      response: { id: 'r', timestamp: new Date(), modelId: 'm' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      finishReason: 'stop',
    })
    expect(mapProviderError(error, AiProviderType.OPENAI).code).toBe('output_validation_failed')
  })
})

describe('toModelMessages (provider-agnostic turn mapping, Arc E)', () => {
  it('maps user and assistant text turns unchanged', () => {
    expect(
      toModelMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ])
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('maps an assistant tool-call turn to tool-call content parts', () => {
    expect(
      toModelMessages([
        {
          role: 'assistant',
          toolCalls: [{ toolCallId: 'c1', toolName: 'current_time', input: {} }],
        },
      ])
    ).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'current_time', input: {} }],
      },
    ])
  })

  it('maps a tool-result turn to a tool message with a text output part', () => {
    expect(
      toModelMessages([
        {
          role: 'tool',
          toolResults: [{ toolCallId: 'c1', toolName: 'current_time', output: 'now' }],
        },
      ])
    ).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'current_time',
            output: { type: 'text', value: 'now' },
          },
        ],
      },
    ])
  })

  it('accepts the Arc E.5 synthetic approval toolCallId, paired across the assistant + tool turns', () => {
    // The approval-gated resume path pairs turns with `ai-tool-inv:<invocationId>` (no original
    // provider id is persisted). The provider mapping must carry it through verbatim on both turns.
    const synthetic = 'ai-tool-inv:inv-abc'
    expect(
      toModelMessages([
        {
          role: 'assistant',
          toolCalls: [{ toolCallId: synthetic, toolName: 'danger', input: {} }],
        },
        {
          role: 'tool',
          toolResults: [{ toolCallId: synthetic, toolName: 'danger', output: 'ok' }],
        },
      ])
    ).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: synthetic, toolName: 'danger', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: synthetic,
            toolName: 'danger',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ])
  })
})

describe('toSdkTools (Arc E)', () => {
  const tools: AiGatewayTool[] = [
    { name: 'current_time', description: 'Returns the time.', parameters: z.object({}).strict() },
  ]

  it('registers each tool by name with a description and no execute (no auto-execution)', () => {
    const set = toSdkTools(tools)
    expect(Object.keys(set)).toEqual(['current_time'])
    expect(set.current_time!.description).toBe('Returns the time.')
    expect(set.current_time!.execute).toBeUndefined()
  })
})
