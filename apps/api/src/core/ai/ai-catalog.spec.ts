import {
  aiModelSelectionSchema,
  createAiAssistantSchema,
  createAiModelSchema,
  createAiProviderSchema,
} from '@amcore/shared'

/**
 * Contract tests for the AI admin catalog inputs (Track C — ADR-054, Arc A): provider, model,
 * and assistant create schemas. Proves malformed catalog input is rejected and defaults apply.
 */

describe('createAiProviderSchema', () => {
  it('accepts a minimal provider and defaults enabled=false', () => {
    const parsed = createAiProviderSchema.parse({
      slug: 'anthropic-default',
      type: 'anthropic',
      displayName: 'Anthropic',
    })
    expect(parsed.enabled).toBe(false)
    expect(parsed.dataRetentionClass).toBe('provider_default')
  })

  it('rejects a raw env-var-shaped credentialSlot (slot is a bounded identifier)', () => {
    expect(
      createAiProviderSchema.safeParse({
        slug: 'anthropic-default',
        type: 'anthropic',
        displayName: 'Anthropic',
        credentialSlot: 'JWT_SECRET',
      }).success
    ).toBe(false)
  })

  it('rejects a non-URL baseUrl', () => {
    expect(
      createAiProviderSchema.safeParse({
        slug: 'local',
        type: 'openai_compatible',
        displayName: 'Local',
        baseUrl: 'not-a-url',
      }).success
    ).toBe(false)
  })
})

describe('createAiModelSchema', () => {
  it('requires a capability map', () => {
    expect(
      createAiModelSchema.safeParse({
        providerId: 'prov_1',
        slug: 'claude-default',
        providerModelName: 'claude-opus-4-8',
        displayName: 'Claude (default)',
      }).success
    ).toBe(false)
  })

  it('accepts a full model row', () => {
    expect(
      createAiModelSchema.safeParse({
        providerId: 'prov_1',
        slug: 'claude-default',
        providerModelName: 'claude-opus-4-8',
        displayName: 'Claude (default)',
        isDefault: true,
        capabilities: { text: true, tools: true, vision: true, streaming: true },
        contextLimit: 200000,
      }).success
    ).toBe(true)
  })
})

describe('aiModelSelectionSchema', () => {
  it('defaults the fallback chain to empty', () => {
    const parsed = aiModelSelectionSchema.parse({ modelSlug: 'claude-default' })
    expect(parsed.fallback).toEqual([])
  })
})

describe('createAiAssistantSchema', () => {
  it('defaults modalities to text and tools to none', () => {
    const parsed = createAiAssistantSchema.parse({
      slug: 'support',
      displayName: 'Support',
      modelSelection: { modelSlug: 'claude-default' },
    })
    expect(parsed.allowedModalities).toEqual(['text'])
    expect(parsed.toolAllowlist).toEqual([])
  })
})
