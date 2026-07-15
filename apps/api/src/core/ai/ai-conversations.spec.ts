import { aiTextOnlyMessageContentSchema, postOperatorMessageSchema } from '@amcore/shared'

/**
 * Contract tests for the AI conversation takeover/operator schemas (Track C — ADR-054, Arc F.3 /
 * Arc G). Focus: the Arc G tightening that the operator/owner human-turn content is **text only** —
 * an `artifact_ref` is refused at the contract boundary (the run-input path is the only artifact
 * surface this arc). The full takeover/reason contracts are otherwise exercised via the service specs.
 */

describe('aiTextOnlyMessageContentSchema (Arc G)', () => {
  it('accepts a text-only turn', () => {
    expect(
      aiTextOnlyMessageContentSchema.safeParse([{ type: 'text', text: 'let me help' }]).success
    ).toBe(true)
  })

  it('accepts several text parts', () => {
    expect(
      aiTextOnlyMessageContentSchema.safeParse([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]).success
    ).toBe(true)
  })

  it('rejects an artifact_ref part (artifacts are not supported on the human-turn path)', () => {
    expect(
      aiTextOnlyMessageContentSchema.safeParse([{ type: 'artifact_ref', artifactId: 'art_1' }])
        .success
    ).toBe(false)
  })

  it('rejects a turn mixing text with an artifact_ref (all parts must be text)', () => {
    expect(
      aiTextOnlyMessageContentSchema.safeParse([
        { type: 'text', text: 'see this' },
        { type: 'artifact_ref', artifactId: 'art_1' },
      ]).success
    ).toBe(false)
  })

  it('still enforces the base content rules (no empty array)', () => {
    expect(aiTextOnlyMessageContentSchema.safeParse([]).success).toBe(false)
  })
})

describe('postOperatorMessageSchema (Arc G)', () => {
  it('accepts a text-only content with an optional reason', () => {
    const result = postOperatorMessageSchema.safeParse({
      content: [{ type: 'text', text: 'on it' }],
      reason: 'SUPPORT-1234',
    })
    expect(result.success).toBe(true)
  })

  it('rejects content carrying an artifact_ref part (400 at the DTO/pipe boundary)', () => {
    const result = postOperatorMessageSchema.safeParse({
      content: [{ type: 'artifact_ref', artifactId: 'art_1' }],
    })
    expect(result.success).toBe(false)
  })
})
