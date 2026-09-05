import { describe, expect, it } from 'vitest'

import { aiModelSelectionSchema, createAiAssistantSchema } from './ai-assistants'

/**
 * Contract tests for the AI admin assistant/model-selection inputs (Track C —
 * ADR-054, Arc A). Proves defaults apply for optional fields.
 */

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
