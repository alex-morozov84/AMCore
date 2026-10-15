import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

import { AiProviderType } from '../../../../generated/prisma/client.js'
import { AiGatewayException } from '../ai-gateway.error.js'
import type { AiAdapterCall } from '../ai-gateway.types.js'

import { AbstractAiSdkAdapter } from './ai-sdk.adapter.base.js'

/**
 * Anthropic / Claude adapter (Track C — ADR-054, Arc B) — the default provider family. The SDK
 * sets the `x-api-key` header from `apiKey` and uses Anthropic's own base URL. The base URL is
 * **code-owned** (the SDK default): the catalog's `provider.baseUrl` is deliberately IGNORED so a
 * compromised/admin-edited row can never redirect the `x-api-key` to a foreign endpoint. The
 * credential is already gated by the ModelGateway, but re-checked so the adapter never calls
 * without a key.
 */
export class AnthropicAdapter extends AbstractAiSdkAdapter {
  readonly supportedTypes = [AiProviderType.ANTHROPIC] as const

  protected resolveLanguageModel(call: AiAdapterCall): LanguageModel {
    if (call.credential === null) throw AiGatewayException.modelNotConfigured(call.model.slug)
    const provider = createAnthropic({ apiKey: call.credential, fetch: this.fetchImpl })
    return provider(call.model.providerModelName)
  }
}
