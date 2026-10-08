import { jest } from '@jest/globals'

import type { AiModel, AiProvider } from '../../src/generated/prisma/client'
import { AiCredentialResolver } from '../../src/infrastructure/ai/gateway/credential-resolver'
import { AnthropicAdapter } from '../../src/infrastructure/ai/gateway/providers/anthropic.adapter'
import { OpenAICompatibleAdapter } from '../../src/infrastructure/ai/gateway/providers/openai-compatible.adapter'
import { AiModelRegistry } from '../../src/infrastructure/ai/registry/ai-model-registry.service'
import { AiRunDispatchService } from '../../src/infrastructure/ai/runs/ai-run-dispatch.service'
import type { E2ETestContext } from '../helpers'

export const sdkFixture = {
  status: 200,
  header: undefined as string | undefined,
  content: 'safe answer',
  finish: 'stop',
  usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } as
    Record<string, number> | undefined,
  calls: [] as Array<{
    url: string
    headers: Headers
    body: Record<string, unknown>
    redirect?: 'error' | 'follow' | 'manual'
  }>,
  afterResponse: undefined as (() => Promise<void>) | undefined,
  reset(): void {
    this.status = 200
    this.header = undefined
    this.content = 'safe answer'
    this.finish = 'stop'
    this.usage = { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
    this.calls = []
    this.afterResponse = undefined
  },
}
const fetchImpl: typeof fetch = async (input, init) => {
  sdkFixture.calls.push({
    url: String(input),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)),
    redirect: init?.redirect,
  })
  const anthropic = String(input).includes('anthropic.com')
  const body =
    sdkFixture.status !== 200
      ? { error: { type: 'overloaded_error', message: 'fixture unavailable' } }
      : anthropic
        ? {
            id: 'msg_fixture',
            type: 'message',
            role: 'assistant',
            model: 'wire-a',
            content: [{ type: 'text', text: sdkFixture.content }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 8, output_tokens: 4 },
          }
        : {
            id: 'chatcmpl_fixture',
            object: 'chat.completion',
            created: 0,
            model: 'wire-a',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: sdkFixture.content },
                finish_reason: sdkFixture.finish,
              },
            ],
            usage: sdkFixture.usage,
          }
  await sdkFixture.afterResponse?.()
  return new Response(JSON.stringify(body), {
    status: sdkFixture.status,
    headers: {
      'content-type': 'application/json',
      ...(sdkFixture.header ? { 'retry-after': sdkFixture.header } : {}),
    },
  })
}
export function sdkAdapters(): Array<OpenAICompatibleAdapter | AnthropicAdapter> {
  return [new OpenAICompatibleAdapter(fetchImpl), new AnthropicAdapter(fetchImpl)]
}

/** Producer really freezes the selected enabled DB rows; only provider transport is substituted. */
export async function selectSdkModel(
  context: E2ETestContext,
  type: 'OPENAI_COMPATIBLE' | 'ANTHROPIC' = 'OPENAI_COMPATIBLE'
): Promise<{ model: AiModel; provider: AiProvider; rotate: () => void }> {
  let credential = '<fixture-credential-a>'
  jest
    .spyOn(AiCredentialResolver.prototype, 'getCredential')
    .mockImplementation((family, slot) =>
      family === type && slot === 'default' ? credential : null
    )
  await context.prisma.aiModel.updateMany({ data: { isDefault: false } })
  const provider = await context.prisma.aiProvider.create({
    data: {
      slug: 'fixture-provider',
      displayName: 'Fixture',
      type,
      enabled: true,
      credentialSlot: 'default',
      baseUrl: 'https://fixture.example/v1',
    },
  })
  const model = await context.prisma.aiModel.create({
    data: {
      slug: 'fixture-model',
      providerId: provider.id,
      displayName: 'Fixture',
      providerModelName: 'wire-a',
      enabled: true,
      isDefault: true,
      capabilities: { text: true, structured_output: true },
      maxOutputTokens: 123,
      contextLimit: 4096,
    },
  })
  await context.app.get(AiModelRegistry).invalidate()
  const selected = await context.app.get(AiModelRegistry).resolveDefaultModel()
  if (selected?.id !== model.id)
    throw new Error(
      `fixture selection failed: ${selected?.slug}; credential=${context.app.get(AiCredentialResolver).hasCredential(type, 'default')}`
    )
  return {
    provider,
    model,
    rotate: () => {
      credential = '<fixture-credential-b>'
    },
  }
}
export async function drainConsistency(context: E2ETestContext): Promise<void> {
  await context.app.get(AiRunDispatchService).drainDueBatches()
}
