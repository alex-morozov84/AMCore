import { describe, expect, it } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

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

describe('background work catalogue', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      typeof child === 'object' && child !== null
        ? keys(child, `${prefix}${key}.`)
        : [`${prefix}${key}`]
    )

  it('has the same keys in every locale', () => {
    expect(keys(ru.console.backgroundWork).sort()).toEqual(keys(en.console.backgroundWork).sort())
  })

  it('has copy for every stock queue and every kind', () => {
    for (const name of ['email', 'default', 'notifications', 'ai-runs']) {
      expect(en.console.backgroundWork.queues).toHaveProperty(name)
    }
    for (const kind of ['work', 'wake', 'extension']) {
      expect(en.console.backgroundWork.kinds).toHaveProperty(kind)
    }
  })

  it('uses ICU plurals for ages, with Russian few/many forms', () => {
    for (const unit of ['ageSeconds', 'ageMinutes', 'ageHours', 'ageDays'] as const) {
      expect(en.console.backgroundWork[unit]).toContain('plural')
      expect(ru.console.backgroundWork[unit]).toMatch(/few .* many .* other/)
    }
  })
})
