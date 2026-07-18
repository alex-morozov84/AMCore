import type { AiProviderType } from '../src/generated/prisma/client'

/**
 * Declarative AI catalog seed data (Track C — ADR-054, Arc A). The intent is that a fresh
 * fork sees the **intended configuration shape** without needing live keys:
 *   - `mock` is enabled and key-less — the deterministic dev/test provider (mirrors the email
 *     Mock provider), so the engine works out of the box.
 *   - `anthropic` is the shipped default (Claude is the default model, `isDefault`), enabled so
 *     the catalog declares the intent; the Arc B gateway gates it on a real key and falls back
 *     to `mock` when none is configured. `credentialSlot` is a logical slot resolved through a
 *     code-owned allowlist at runtime, never a raw env name.
 *   - `openai` / `openrouter` / `openai_compatible` / `yandex_ai_studio` are **disabled
 *     examples** showing how to wire each family (a fork enables one by adding a key/config).
 *
 * No secret is ever seeded. Capability maps follow the bounded `aiCapabilityMapSchema` shape.
 */

export type SeedModel = {
  slug: string
  providerModelName: string
  displayName: string
  enabled: boolean
  isDefault: boolean
  capabilities: Record<string, boolean>
  contextLimit?: number
  maxOutputTokens?: number
}

export type SeedProvider = {
  slug: string
  type: AiProviderType
  displayName: string
  enabled: boolean
  baseUrl?: string
  credentialSlot?: string
  config?: Record<string, unknown>
  models: SeedModel[]
}

export const AI_CATALOG_SEED: SeedProvider[] = [
  {
    slug: 'mock',
    type: 'MOCK',
    displayName: 'Mock (deterministic)',
    enabled: true,
    models: [
      {
        slug: 'mock-default',
        providerModelName: 'mock',
        displayName: 'Mock model',
        enabled: true,
        isDefault: false,
        // The key-less mock generates deterministic text only; it does not synthesize
        // arbitrary structured output, so `structured_output` is intentionally absent.
        capabilities: { text: true, tools: true, streaming: true },
      },
    ],
  },
  {
    slug: 'anthropic',
    type: 'ANTHROPIC',
    displayName: 'Anthropic',
    enabled: true,
    credentialSlot: 'default',
    models: [
      {
        slug: 'claude-default',
        providerModelName: 'claude-opus-4-8',
        displayName: 'Claude (default)',
        enabled: true,
        isDefault: true,
        capabilities: {
          text: true,
          tools: true,
          vision: true,
          pdf: true,
          streaming: true,
          structured_output: true,
        },
        contextLimit: 200_000,
        maxOutputTokens: 64_000,
      },
    ],
  },
  {
    slug: 'openai',
    type: 'OPENAI',
    displayName: 'OpenAI (example)',
    enabled: false,
    credentialSlot: 'default',
    models: [
      {
        slug: 'gpt-default',
        providerModelName: 'gpt-4o',
        displayName: 'GPT (example)',
        enabled: false,
        isDefault: false,
        capabilities: { text: true, tools: true, vision: true, streaming: true },
      },
    ],
  },
  {
    slug: 'openrouter',
    type: 'OPENROUTER',
    displayName: 'OpenRouter (example)',
    enabled: false,
    credentialSlot: 'default',
    models: [
      {
        slug: 'openrouter-claude',
        providerModelName: 'anthropic/claude-opus-4-8',
        displayName: 'OpenRouter → Claude (example)',
        enabled: false,
        isDefault: false,
        capabilities: { text: true, tools: true, streaming: true },
      },
    ],
  },
  {
    slug: 'local-openai-compatible',
    type: 'OPENAI_COMPATIBLE',
    displayName: 'OpenAI-compatible endpoint (example)',
    enabled: false,
    baseUrl: 'https://your-endpoint.example/v1',
    credentialSlot: 'default',
    models: [
      {
        slug: 'local-model',
        providerModelName: 'local-model',
        displayName: 'Local / self-hosted model (example)',
        enabled: false,
        isDefault: false,
        capabilities: { text: true, streaming: true },
      },
    ],
  },
  {
    slug: 'yandex-ai-studio',
    type: 'YANDEX_AI_STUDIO',
    displayName: 'Yandex AI Studio (example)',
    enabled: false,
    credentialSlot: 'default',
    config: { folderId: 'your-folder-id' },
    models: [
      {
        slug: 'yandexgpt-default',
        providerModelName: 'gpt://your-folder-id/yandexgpt/latest',
        displayName: 'YandexGPT (example)',
        enabled: false,
        isDefault: false,
        capabilities: { text: true, streaming: true },
      },
    ],
  },
]
