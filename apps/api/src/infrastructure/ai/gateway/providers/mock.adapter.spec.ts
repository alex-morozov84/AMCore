import { AiProviderType } from '@prisma/client'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall } from '../ai-gateway.types'

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

  it('matches sentinels as substrings so they fire inside the Arc D trust-boundary envelope', async () => {
    const wrapped = '<amcore:user-data-xyz>\n{"text":"__mock_error__"}\n</amcore:user-data-xyz>'
    await expect(
      adapter.generateText(call({ messages: [{ role: 'user', content: wrapped }] }))
    ).rejects.toThrow('mock adapter forced failure')
  })
})
