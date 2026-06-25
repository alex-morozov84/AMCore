import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { AiProviderType } from '@prisma/client'
import type { LanguageModel } from 'ai'

import { AiGatewayException } from '../ai-gateway.error'
import type { AiAdapterCall } from '../ai-gateway.types'

import { AbstractAiSdkAdapter } from './ai-sdk.adapter.base'

/**
 * OpenAI-compatible adapter (Track C — ADR-054, Arc B) — one adapter for every OpenAI-shaped
 * family: OpenAI, OpenRouter, Yandex AI Studio, and any compatible endpoint. The per-type base URL
 * and auth scheme are **code-owned**, never admin-editable: Yandex authenticates with an
 * `Authorization: Api-Key …` header (not Bearer), and its model id is the catalog's
 * `gpt://<folder_id>/<model>` URI passed through unchanged. For the **named** families
 * (OpenAI/OpenRouter/Yandex) the base URL comes ONLY from `FAMILY` — the catalog's
 * `provider.baseUrl` is ignored so a tampered row cannot redirect the credential to a foreign
 * endpoint. Only the generic `OPENAI_COMPATIBLE` type (whose whole purpose is a custom endpoint)
 * reads `provider.baseUrl`, and it is required there.
 */
type FamilyConfig = { baseUrl?: string; auth: 'bearer' | 'api-key' }

const FAMILY: Partial<Record<AiProviderType, FamilyConfig>> = {
  [AiProviderType.OPENAI]: { baseUrl: 'https://api.openai.com/v1', auth: 'bearer' },
  [AiProviderType.OPENROUTER]: { baseUrl: 'https://openrouter.ai/api/v1', auth: 'bearer' },
  [AiProviderType.YANDEX_AI_STUDIO]: {
    baseUrl: 'https://llm.api.cloud.yandex.net/v1',
    auth: 'api-key',
  },
  [AiProviderType.OPENAI_COMPATIBLE]: { auth: 'bearer' },
}

export class OpenAICompatibleAdapter extends AbstractAiSdkAdapter {
  readonly supportedTypes = [
    AiProviderType.OPENAI,
    AiProviderType.OPENROUTER,
    AiProviderType.OPENAI_COMPATIBLE,
    AiProviderType.YANDEX_AI_STUDIO,
  ] as const

  protected resolveLanguageModel(call: AiAdapterCall): LanguageModel {
    const type = call.model.provider.type
    const family = FAMILY[type]
    if (family === undefined || call.credential === null) {
      throw AiGatewayException.modelNotConfigured(call.model.slug)
    }
    // Named families use ONLY the code-owned base URL (DB `baseUrl` is ignored — anti-exfiltration);
    // the generic compatible type is the sole case that reads the catalog-supplied base URL.
    const baseURL =
      type === AiProviderType.OPENAI_COMPATIBLE ? call.model.provider.baseUrl : family.baseUrl
    if (baseURL === undefined || baseURL === null) {
      throw AiGatewayException.modelNotConfigured(call.model.slug)
    }

    const provider = createOpenAICompatible({
      name: type.toLowerCase(),
      baseURL,
      fetch: this.fetchImpl,
      // Send real provider-side structured output (`response_format.type: 'json_schema'`) instead
      // of degrading to `json_object` + local validation, but only when the catalog model declares
      // the capability — a model marked otherwise must not claim schema-enforced output.
      supportsStructuredOutputs: call.model.capabilities.structured_output === true,
      ...(family.auth === 'api-key'
        ? { headers: { Authorization: `Api-Key ${call.credential}` } }
        : { apiKey: call.credential }),
    })
    return provider(call.model.providerModelName)
  }
}
