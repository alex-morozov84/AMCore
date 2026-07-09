import { Injectable } from '@nestjs/common'
import { AiProviderType } from '@prisma/client'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall, AiProviderAdapter, AiTextResult, AiUsage } from '../ai-gateway.types'

/** Rough deterministic token estimate (~4 chars/token) for the key-less mock. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
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
 * Deterministic, key-less mock provider adapter (Track C — ADR-054, Arc B). Mirrors the email
 * Mock provider: the engine works out of the box without credentials, and tests get a stable
 * output. It performs NO network I/O and answers the user's inner content (see `readUserContent`).
 * Sentinel inputs let tests exercise the runtime without a real provider: `__mock_error__` (a raw
 * failure → normalized to `provider_unavailable`), `__mock_refusal__` (a safety refusal →
 * `content_filtered`), and `__mock_leak__` (emits a boundary-marker-bearing output so the Arc D
 * output guard blocks it).
 */
@Injectable()
export class MockAiAdapter implements AiProviderAdapter {
  readonly supportedTypes = [AiProviderType.MOCK] as const

  async generateText(call: AiAdapterCall): Promise<AiTextResult> {
    const rawLastUser = [...call.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const userContent = readUserContent(rawLastUser)

    if (userContent.includes('__mock_error__')) throw new Error('mock adapter forced failure')
    if (userContent.includes('__mock_refusal__')) {
      throw AiGatewayException.contentFiltered(call.model.provider.type)
    }

    let text = `[mock:${call.model.providerModelName}] ${userContent}`.trim()
    // Simulate a model that leaks the boundary marker into its output (Arc D output-guard test hook).
    if (userContent.includes('__mock_leak__')) text = `${text} amcore:user-data-leaked`

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
