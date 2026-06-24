import {
  AI_PROVIDER_TYPES,
  aiCapabilityMapSchema,
  aiConfigObjectSchema,
  aiDecimalStringSchema,
  aiProviderTypeSchema,
  aiSlugSchema,
} from '@amcore/shared'

/**
 * Contract tests for the AI vocabulary primitives (Track C — ADR-054, Arc A): bounded
 * grammars, the capability map, the precision-safe decimal string, and the bounded non-secret
 * config object — the load-bearing validation a later arc's gateway/registry depends on.
 */

describe('aiSlugSchema', () => {
  it.each(['anthropic-default', 'claude_default', 'gpt4o', 'mock'])('accepts %s', (slug) => {
    expect(aiSlugSchema.safeParse(slug).success).toBe(true)
  })

  it.each(['Anthropic', 'with space', '1leading', 'trailing-', 'double--dash', ''])(
    'rejects %s',
    (slug) => {
      expect(aiSlugSchema.safeParse(slug).success).toBe(false)
    }
  )
})

describe('aiProviderTypeSchema', () => {
  it('accepts every wire provider type', () => {
    for (const type of AI_PROVIDER_TYPES) {
      expect(aiProviderTypeSchema.safeParse(type).success).toBe(true)
    }
  })

  it('rejects a SCREAMING_CASE DB token (wire is lowercase)', () => {
    expect(aiProviderTypeSchema.safeParse('ANTHROPIC').success).toBe(false)
  })

  it('rejects an unknown provider type', () => {
    expect(aiProviderTypeSchema.safeParse('gemini').success).toBe(false)
  })
})

describe('aiCapabilityMapSchema', () => {
  it('accepts a bounded-key boolean map', () => {
    expect(
      aiCapabilityMapSchema.safeParse({
        text: true,
        tools: true,
        vision: false,
        structured_output: true,
      }).success
    ).toBe(true)
  })

  it('accepts an unknown but grammar-valid capability key (additive)', () => {
    expect(aiCapabilityMapSchema.safeParse({ web_search: true }).success).toBe(true)
  })

  it('rejects a non-boolean capability value', () => {
    expect(aiCapabilityMapSchema.safeParse({ text: 'yes' }).success).toBe(false)
  })

  it('rejects a malformed capability key', () => {
    expect(aiCapabilityMapSchema.safeParse({ 'Bad Key': true }).success).toBe(false)
  })

  it('rejects more than the entry cap', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`cap_${i}`, true]))
    expect(aiCapabilityMapSchema.safeParse(tooMany).success).toBe(false)
  })
})

describe('aiDecimalStringSchema', () => {
  it.each(['0', '0.00123400', '12.5', '999999999999.99999999'])('accepts %s', (value) => {
    expect(aiDecimalStringSchema.safeParse(value).success).toBe(true)
  })

  it.each(['abc', '-1', '1.123456789', '1.', '.5', '1e3'])('rejects %s', (value) => {
    expect(aiDecimalStringSchema.safeParse(value).success).toBe(false)
  })
})

describe('aiConfigObjectSchema', () => {
  it('accepts a bounded non-secret config (e.g. a Yandex folder ref)', () => {
    expect(
      aiConfigObjectSchema.safeParse({ folderId: 'b1g...', region: 'ru-central1', sync: true })
        .success
    ).toBe(true)
  })

  it.each(['apiKey', 'api_key', 'secretToken', 'password', 'awsCredential', 'key'])(
    'rejects a secret-looking key %s',
    (key) => {
      expect(aiConfigObjectSchema.safeParse({ [key]: 'x' }).success).toBe(false)
    }
  )

  it('rejects a nested object value (no depth)', () => {
    expect(aiConfigObjectSchema.safeParse({ nested: { a: 1 } }).success).toBe(false)
  })

  it('rejects more than the key cap', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 1]))
    expect(aiConfigObjectSchema.safeParse(tooMany).success).toBe(false)
  })
})
