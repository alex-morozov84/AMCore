import { AiProviderType } from '../../src/generated/prisma/client.js'
import type { AiAdapterCall } from '../../src/infrastructure/ai/gateway/ai-gateway.types.js'
import { OpenAICompatibleAdapter } from '../../src/infrastructure/ai/gateway/providers/openai-compatible.adapter.js'

/** A real SDK transport boundary: every request is handled here, never by global fetch. */
export function structuredFixture(
  content: string | null,
  finish = 'stop'
): { adapter: OpenAICompatibleAdapter; call: AiAdapterCall; requests: RequestInit[] } {
  const requests: RequestInit[] = []
  const fetchImpl: typeof fetch = async (_input, init) => {
    requests.push(init ?? {})
    return Response.json({
      id: 'fixture',
      object: 'chat.completion',
      created: 0,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    })
  }
  const call: AiAdapterCall = {
    model: {
      id: 'model',
      slug: 'm',
      providerModelName: 'm',
      capabilities: { text: true, structured_output: true },
      contextLimit: null,
      maxOutputTokens: null,
      isDefault: false,
      provider: {
        id: 'provider',
        slug: 'p',
        type: AiProviderType.OPENAI_COMPATIBLE,
        baseUrl: 'https://provider.invalid/v1',
        credentialSlot: 'default',
        dataRetentionClass: 'provider_default',
        config: null,
      },
    },
    credential: '<fixture-key>',
    messages: [{ role: 'user', content: 'fixture' }],
    timeoutMs: 60000,
  }
  return { adapter: new OpenAICompatibleAdapter(fetchImpl), call, requests }
}

export function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
