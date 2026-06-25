import { Injectable } from '@nestjs/common'
import { AiProviderType } from '@prisma/client'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall, AiProviderAdapter, AiTextResult, AiUsage } from '../ai-gateway.types'

/** Rough deterministic token estimate (~4 chars/token) for the key-less mock. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Deterministic, key-less mock provider adapter (Track C — ADR-054, Arc B). Mirrors the email
 * Mock provider: the engine works out of the box without credentials, and tests get a stable
 * output. It performs NO network I/O. Two sentinel inputs let tests exercise the gateway's error
 * normalization without a real provider: `__mock_error__` (a raw failure → normalized to
 * `provider_unavailable`) and `__mock_refusal__` (a safety refusal → `content_filtered`).
 */
@Injectable()
export class MockAiAdapter implements AiProviderAdapter {
  readonly supportedTypes = [AiProviderType.MOCK] as const

  async generateText(call: AiAdapterCall): Promise<AiTextResult> {
    const lastUser = [...call.messages].reverse().find((m) => m.role === 'user')?.content ?? ''

    if (lastUser === '__mock_error__') throw new Error('mock adapter forced failure')
    if (lastUser === '__mock_refusal__') {
      throw AiGatewayException.contentFiltered(call.model.provider.type)
    }

    const text = `[mock:${call.model.providerModelName}] ${lastUser}`.trim()
    const inputTokens =
      call.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0) +
      estimateTokens(call.system ?? '')
    const outputTokens = estimateTokens(text)
    const usage: AiUsage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }

    return {
      text,
      finishReason: 'stop',
      usage,
      modelSlug: call.model.slug,
      providerType: call.model.provider.type,
    }
  }
}
