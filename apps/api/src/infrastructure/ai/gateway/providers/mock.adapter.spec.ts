import { AiProviderType } from '@prisma/client'
import { z } from 'zod'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall, AiGatewayTool } from '../ai-gateway.types'

import { MockAiAdapter } from './mock.adapter'

function call(over: Partial<AiAdapterCall> = {}): AiAdapterCall {
  return {
    model: {
      slug: 'mock-default',
      providerModelName: 'mock',
      capabilities: { text: true },
      contextLimit: null,
      maxOutputTokens: null,
      isDefault: false,
      provider: {
        slug: 'mock',
        type: AiProviderType.MOCK,
        baseUrl: null,
        credentialSlot: null,
        dataRetentionClass: 'provider_default',
        config: null,
      },
    },
    credential: null,
    messages: [{ role: 'user', content: 'hello' }],
    timeoutMs: 60000,
    ...over,
  }
}

describe('MockAiAdapter', () => {
  const adapter = new MockAiAdapter()

  it('returns a deterministic text echo with token usage', async () => {
    const result = await adapter.generateText(call())
    expect(result.text).toBe('[mock:mock] hello')
    expect(result.finishReason).toBe('stop')
    expect(result.providerType).toBe(AiProviderType.MOCK)
    expect(result.usage.totalTokens).toBe(result.usage.inputTokens + result.usage.outputTokens)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  })

  it('is deterministic for the same input', async () => {
    const a = await adapter.generateText(call())
    const b = await adapter.generateText(call())
    expect(a).toEqual(b)
  })

  it('throws a raw error on the __mock_error__ sentinel', async () => {
    await expect(
      adapter.generateText(call({ messages: [{ role: 'user', content: '__mock_error__' }] }))
    ).rejects.toThrow('mock adapter forced failure')
  })

  it('throws content_filtered on the __mock_refusal__ sentinel', async () => {
    await expect(
      adapter.generateText(call({ messages: [{ role: 'user', content: '__mock_refusal__' }] }))
    ).rejects.toMatchObject({ code: 'content_filtered' })
    await expect(
      adapter.generateText(call({ messages: [{ role: 'user', content: '__mock_refusal__' }] }))
    ).rejects.toBeInstanceOf(AiGatewayException)
  })

  it('reads the inner text of the Arc D trust-boundary envelope and does not echo the marker', async () => {
    const wrapped = '<amcore:user-data-xyz>\n{"text":"hello world"}\n</amcore:user-data-xyz>'
    const result = await adapter.generateText(
      call({ messages: [{ role: 'user', content: wrapped }] })
    )
    expect(result.text).toBe('[mock:mock] hello world')
    expect(result.text).not.toContain('amcore:user-data-')
  })

  it('fires a sentinel carried inside the envelope (read from the inner text)', async () => {
    const wrapped = '<amcore:user-data-xyz>\n{"text":"__mock_error__"}\n</amcore:user-data-xyz>'
    await expect(
      adapter.generateText(call({ messages: [{ role: 'user', content: wrapped }] }))
    ).rejects.toThrow('mock adapter forced failure')
  })

  it('emits a boundary-marker-bearing output on the __mock_leak__ sentinel', async () => {
    const result = await adapter.generateText(
      call({ messages: [{ role: 'user', content: '__mock_leak__' }] })
    )
    expect(result.text).toContain('amcore:user-data-')
  })

  describe('tool script (Arc E)', () => {
    const tools: AiGatewayTool[] = [
      { name: 'current_time', description: 'time', parameters: z.object({}).strict() },
      { name: 'lookup', description: 'lookup', parameters: z.object({}).strict() },
    ]

    it('requests one tool call for the __mock_tool__ sentinel when the tool is offered', async () => {
      const result = await adapter.generateText(
        call({ messages: [{ role: 'user', content: '__mock_tool__:current_time' }], tools })
      )
      expect(result.finishReason).toBe('tool_calls')
      expect(result.toolCalls).toEqual([
        { toolCallId: 'mock-call-1', toolName: 'current_time', input: {} },
      ])
      expect(result.text).toBe('')
    })

    it('does not request a tool when none are offered (falls back to text)', async () => {
      const result = await adapter.generateText(
        call({ messages: [{ role: 'user', content: '__mock_tool__:current_time' }] })
      )
      expect(result.finishReason).toBe('stop')
      expect(result.toolCalls).toEqual([])
    })

    it('ignores a sentinel naming a tool that is not offered (never invents one)', async () => {
      const result = await adapter.generateText(
        call({ messages: [{ role: 'user', content: '__mock_tool__:ghost' }], tools })
      )
      expect(result.toolCalls).toEqual([])
      expect(result.finishReason).toBe('stop')
    })

    it('requests several calls for the __mock_tools__ sentinel', async () => {
      const result = await adapter.generateText(
        call({ messages: [{ role: 'user', content: '__mock_tools__:current_time,lookup' }], tools })
      )
      expect(result.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
        'current_time',
        'lookup',
      ])
      expect(result.finishReason).toBe('tool_calls')
    })

    it('produces a final answer citing outputs once a tool result is in the transcript', async () => {
      const result = await adapter.generateText(
        call({
          messages: [
            { role: 'user', content: '__mock_tool__:current_time' },
            {
              role: 'assistant',
              toolCalls: [{ toolCallId: 'mock-call-1', toolName: 'current_time', input: {} }],
            },
            {
              role: 'tool',
              toolResults: [
                { toolCallId: 'mock-call-1', toolName: 'current_time', output: '2026-07-10' },
              ],
            },
          ],
          tools,
        })
      )
      expect(result.finishReason).toBe('stop')
      expect(result.toolCalls).toEqual([])
      expect(result.text).toContain('tool result: 2026-07-10')
    })
  })
})
