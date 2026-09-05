import { describe, expect, it } from 'vitest'

import { createAiModelSchema, createAiProviderSchema } from './ai-catalog'

/**
 * Contract tests for the AI admin catalog provider/model inputs (Track C —
 * ADR-054, Arc A). Proves malformed catalog input is rejected and defaults
 * apply.
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
