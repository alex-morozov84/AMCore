import { describe, expect, it } from 'vitest'

import { workSummarySchema } from './background-work'

const count = (value: number) => ({ value, truncated: false })
const summary = {
  id: 'legacy-work',
  kind: 'durable',
  status: 'available',
  definitionVersion: 1,
  sampledAt: '2026-10-15T12:00:00.000Z',
  capabilities: [],
  counts: {
    pending: count(0),
    due: count(0),
    processing: count(0),
    failed: count(2),
    terminal: count(5),
    unresolved: count(0),
  },
}

describe('work summary count compatibility', () => {
  it('accepts the existing six counters without Completed', () => {
    expect(workSummarySchema.parse(summary).counts?.completed).toBeUndefined()
  })

  it('accepts exclusive Completed beside the retained terminal total', () => {
    const parsed = workSummarySchema.parse({
      ...summary,
      counts: { ...summary.counts, completed: count(3) },
    })
    expect(parsed.counts?.completed?.value).toBe(3)
    expect(parsed.counts?.terminal.value).toBe(5)
  })

  it('still requires the six original counters and rejects unknown keys', () => {
    const { failed, ...missing } = summary.counts
    expect(workSummarySchema.safeParse({ ...summary, counts: missing }).success).toBe(false)
    expect(
      workSummarySchema.safeParse({
        ...summary,
        counts: { ...summary.counts, unrelated: count(1) },
      }).success
    ).toBe(false)
    expect(failed.value).toBe(2)
  })
})
