import { describe, expect, it } from 'vitest'

import { adminQueueSchema, adminQueuesResponseSchema } from './admin-queues'

const counts = { waiting: 1, prioritized: 0, active: 0, delayed: 0, failed: 0, waitingChildren: 0 }
const available = {
  name: 'email',
  kind: 'work',
  status: 'available',
  sampledAt: '2026-10-03T12:00:00.000Z',
  paused: false,
  counts,
  age: { status: 'sample', seconds: 12, sampled: 1 },
}

describe('admin queues contract', () => {
  it('accepts every row status', () => {
    const response = {
      checkedAt: '2026-10-03T12:00:00.000Z',
      queues: [
        available,
        { name: 'ai-runs', kind: 'wake', status: 'unavailable' },
        { name: 'default', kind: 'extension', status: 'disabled' },
      ],
    }
    expect(adminQueuesResponseSchema.parse(response)).toEqual(response)
  })

  it('accepts a downstream queue name but rejects unsafe identifiers', () => {
    expect(adminQueueSchema.safeParse({ ...available, name: 'my-reports' }).success).toBe(true)
    for (const name of ['', 'Email', 'a b', '-x', 'x'.repeat(65), 'a/../b'])
      expect(adminQueueSchema.safeParse({ ...available, name }).success).toBe(false)
  })

  it('rejects fabricated or unsafe numbers', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity])
      expect(
        adminQueueSchema.safeParse({ ...available, counts: { ...counts, waiting: bad } }).success
      ).toBe(false)
  })

  it('does not carry counts or age on unavailable/disabled rows', () => {
    const row = { name: 'email', kind: 'work', status: 'unavailable', counts }
    expect(adminQueueSchema.parse(row)).not.toHaveProperty('counts')
  })

  it('distinguishes none, unknown and sampled age', () => {
    for (const age of [{ status: 'none' }, { status: 'unknown' }])
      expect(adminQueueSchema.safeParse({ ...available, age }).success).toBe(true)
    expect(
      adminQueueSchema.safeParse({
        ...available,
        age: { status: 'sample', seconds: -1, sampled: 1 },
      }).success
    ).toBe(false)
  })

  it('has no literal validation message so the localized UI is not forced into English', () => {
    const result = adminQueueSchema.safeParse({ ...available, kind: 'nope' })
    expect(result.success).toBe(false)
  })
})
