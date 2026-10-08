import { normalizeAiUsage, usageLedgerV2 } from './ai-usage-v2'

describe('honest usage v2', () => {
  it('retains complete/partial/unavailable counts without manufacturing reported zero', () => {
    expect(normalizeAiUsage({ inputTokens: 0, outputTokens: 2, totalTokens: 2 })).toMatchObject({
      inputTokens: 0,
      availability: 'complete',
      source: 'reported',
    })
    const partial = normalizeAiUsage({ inputTokens: 8 })
    expect(partial).toMatchObject({
      inputTokens: 8,
      outputTokens: null,
      totalTokens: null,
      availability: 'partial',
    })
    expect(usageLedgerV2(partial)).toMatchObject({
      inputTokens: 8,
      outputTokens: 0,
      usageVersion: 2,
      providerReportedUsage: { outputTokens: null },
    })
    expect(normalizeAiUsage({})).toMatchObject({
      availability: 'unavailable',
      source: 'unavailable',
    })
  })
  it.each([-1, 1.5, Infinity, NaN, 2147483648])('does not saturate invalid count %s', (value) => {
    expect(normalizeAiUsage({ inputTokens: value, outputTokens: 2 })).toMatchObject({
      inputTokens: null,
      outputTokens: 2,
      availability: 'partial',
    })
  })
  it('preserves estimated attribution', () => {
    expect(
      normalizeAiUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }, 'estimated')
    ).toMatchObject({ source: 'estimated' })
  })
})
