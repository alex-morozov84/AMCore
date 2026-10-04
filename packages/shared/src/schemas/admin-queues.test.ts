import { describe, expect, it } from 'vitest'

import { adminQueueSchema, adminQueuesResponseSchema } from './admin-queues'

const counts = { waiting: 1, prioritized: 0, active: 0, delayed: 0, failed: 0, waitingChildren: 0 }
const available = {
  name: 'email',
  kind: 'work',
  inBoard: true,
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
      board: { state: 'available' },
      queues: [
        available,
        { name: 'ai-runs', kind: 'wake', inBoard: false, status: 'unavailable' },
        { name: 'default', kind: 'extension', inBoard: true, status: 'disabled' },
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
    const row = { name: 'email', kind: 'work', inBoard: true, status: 'unavailable', counts }
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

describe('queue board state in the summary', () => {
  const base = { checkedAt: '2026-10-03T12:00:00.000Z', queues: [available] }

  it('accepts only the two confirmed board states', () => {
    for (const state of ['available', 'disabled'])
      expect(adminQueuesResponseSchema.safeParse({ ...base, board: { state } }).success).toBe(true)
    for (const state of ['unavailable', 'unknown', '', 1])
      expect(adminQueuesResponseSchema.safeParse({ ...base, board: { state } }).success).toBe(false)
  })

  it('requires the board state and the per-queue board membership', () => {
    expect(adminQueuesResponseSchema.safeParse(base).success).toBe(false)
    const { inBoard: _omitted, ...withoutMembership } = available
    expect(
      adminQueuesResponseSchema.safeParse({
        ...base,
        board: { state: 'available' },
        queues: [withoutMembership],
      }).success
    ).toBe(false)
  })
})
