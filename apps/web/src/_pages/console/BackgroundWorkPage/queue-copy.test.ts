import { describe, expect, it } from 'vitest'

import { ageParts, allUnavailable, isEmpty, queuedCount } from './queue-copy'
import { noCounts } from './queue-fixtures'

describe('queue figures', () => {
  it('shows Waiting as waiting plus prioritized', () => {
    expect(queuedCount({ ...noCounts, waiting: 3, prioritized: 2 })).toBe(5)
  })

  it('derives Empty without counting retained failures', () => {
    expect(isEmpty(noCounts)).toBe(true)
    expect(isEmpty({ ...noCounts, failed: 9 })).toBe(true)
    for (const key of ['waiting', 'prioritized', 'active', 'delayed', 'waitingChildren'] as const) {
      expect(isEmpty({ ...noCounts, [key]: 1 })).toBe(false)
    }
  })

  it('rounds the age down to the largest whole unit', () => {
    expect(ageParts(59)).toEqual({ unit: 'ageSeconds', n: 59 })
    expect(ageParts(60)).toEqual({ unit: 'ageMinutes', n: 1 })
    expect(ageParts(3599)).toEqual({ unit: 'ageMinutes', n: 59 })
    expect(ageParts(7300)).toEqual({ unit: 'ageHours', n: 2 })
    expect(ageParts(172_800)).toEqual({ unit: 'ageDays', n: 2 })
  })

  it('reports an inventory without enabled queues as not all-unavailable', () => {
    expect(allUnavailable([])).toBe(false)
  })
})
