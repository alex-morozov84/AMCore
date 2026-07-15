import type { ResolvedAiModel } from '../registry/ai-registry.types'

import type { AiGenerateMessage } from './ai-gateway.types'

/**
 * Multimodal capability keys the gateway gates on (Track C — ADR-054, Arc G). An `image` content
 * part requires `vision`; a `file` part requires `pdf` — the only two non-text kinds Arc G
 * produces (`AiArtifactKind.IMAGE` / `.PDF`). Bounded to what the shared capability map already
 * declares (`packages/shared/src/schemas/ai-common.ts`); this introduces no new vocabulary.
 */
export type AiMultimodalCapability = 'vision' | 'pdf'

/**
 * The first multimodal capability required by `messages` that `model` does not declare, or `null`
 * when every part is supported (including a plain text-only request). Pure and deterministic — no
 * DB/network/gateway state — so `ModelGateway` can throw on a non-null result while this stays
 * independently unit-testable.
 *
 * This is the **correctness boundary** for any caller, not just the run producer's/executor's
 * discipline: those gate earlier as a fast path and a defense-in-depth backstop respectively, but
 * a caller that skips both (e.g. a future direct `ModelGateway.generateText()` call) still cannot
 * reach a provider with an unsupported part — mirrors the existing `generateObject`
 * `structured_output` gate in `model-gateway.service.ts`.
 */
export function findUnsupportedMultimodalCapability(
  model: ResolvedAiModel,
  messages: AiGenerateMessage[]
): AiMultimodalCapability | null {
  for (const message of messages) {
    if (message.role !== 'user' || typeof message.content === 'string') continue
    for (const part of message.content) {
      if (part.type === 'text') continue
      const capability: AiMultimodalCapability = part.type === 'image' ? 'vision' : 'pdf'
      if (model.capabilities[capability] !== true) return capability
    }
  }
  return null
}
