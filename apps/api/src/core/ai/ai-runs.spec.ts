import { aiMessageContentSchema, aiUsageSummarySchema, createAiRunSchema } from '@amcore/shared'

/**
 * Contract tests for the AI run/message contracts (Track C — ADR-054, Arc A): the multimodal
 * content-part contract (structured, not a flat string), run creation, and the usage summary.
 */

describe('aiMessageContentSchema', () => {
  it('accepts a text part', () => {
    expect(aiMessageContentSchema.safeParse([{ type: 'text', text: 'hello' }]).success).toBe(true)
  })

  it('accepts a mixed text + artifact_ref turn (multimodal)', () => {
    expect(
      aiMessageContentSchema.safeParse([
        { type: 'text', text: 'describe this' },
        { type: 'artifact_ref', artifactId: 'art_1' },
      ]).success
    ).toBe(true)
  })

  it('rejects a flat string (must be structured parts)', () => {
    expect(aiMessageContentSchema.safeParse('hello').success).toBe(false)
  })

  it('rejects an unknown part type', () => {
    expect(aiMessageContentSchema.safeParse([{ type: 'audio', url: 'x' }]).success).toBe(false)
  })

  it('rejects an empty parts array', () => {
    expect(aiMessageContentSchema.safeParse([]).success).toBe(false)
  })
})

describe('createAiRunSchema', () => {
  it('accepts structured inputParts with an idempotency key', () => {
    expect(
      createAiRunSchema.safeParse({
        conversationId: 'conv_1',
        inputParts: [{ type: 'text', text: 'Hello' }],
        idempotencyKey: 'aB0_-Zz9',
      }).success
    ).toBe(true)
  })

  it('rejects a flat-string input (legacy shape)', () => {
    expect(
      createAiRunSchema.safeParse({ conversationId: 'conv_1', inputParts: 'Hello' }).success
    ).toBe(false)
  })
})

describe('aiUsageSummarySchema', () => {
  it('keeps estimatedCost as a decimal string (precision-safe)', () => {
    expect(
      aiUsageSummarySchema.safeParse({
        modelSlug: 'claude-default',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        toolCalls: 0,
        estimatedCost: '0.00123400',
        currency: 'USD',
      }).success
    ).toBe(true)
  })

  it('rejects a non-decimal estimatedCost', () => {
    expect(
      aiUsageSummarySchema.safeParse({
        modelSlug: 'claude-default',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCalls: 0,
        estimatedCost: 'abc',
        currency: 'USD',
      }).success
    ).toBe(false)
  })

  it('rejects a 2-letter currency', () => {
    expect(
      aiUsageSummarySchema.safeParse({
        modelSlug: 'claude-default',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCalls: 0,
        estimatedCost: null,
        currency: 'US',
      }).success
    ).toBe(false)
  })
})
