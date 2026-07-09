import { sanitizeGuardrailCategories } from './guardrail-step-detail'

describe('sanitizeGuardrailCategories (shared content-free step-detail boundary)', () => {
  it('keeps only bounded lowercase codes with positive safe-integer counts', () => {
    expect(
      sanitizeGuardrailCategories([
        { category: 'instruction_override', count: 2 },
        { category: 'envelope_marker_abuse', count: 1 },
      ])
    ).toEqual([
      { category: 'instruction_override', count: 2 },
      { category: 'envelope_marker_abuse', count: 1 },
    ])
  })

  it('drops marker values, snippets, whitespace/uppercase codes, and bad counts', () => {
    const result = sanitizeGuardrailCategories([
      { category: 'amcore:user-data-abc123', count: 1 }, // marker value → invalid grammar
      { category: 'ignore all previous instructions', count: 1 }, // snippet → spaces invalid
      { category: 'ENVELOPE_MARKER_ABUSE', count: 1 }, // uppercase → invalid
      { category: 'system_prompt_probe', count: 0 }, // non-positive count
      { category: 'obfuscation', count: 1.5 }, // non-integer count
      { category: 'x'.repeat(200), count: 1 }, // oversized code
      { category: 'instruction_override', count: 3 }, // valid → survives
    ])
    expect(result).toEqual([{ category: 'instruction_override', count: 3 }])
    expect(JSON.stringify(result)).not.toContain('amcore:user-data-')
    expect(JSON.stringify(result)).not.toContain('ignore all previous instructions')
  })

  it('caps the list length and tolerates undefined/non-array input', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ category: `cat_${i}`, count: 1 }))
    expect(sanitizeGuardrailCategories(many)).toHaveLength(16)
    expect(sanitizeGuardrailCategories(undefined)).toEqual([])
  })
})
