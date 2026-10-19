import { describe, expect, it } from 'vitest'

import {
  memberRemovalCommandSchema,
  memberRemovalQuerySchema,
  memberRemovalResultSchema,
} from './organization-members'

describe('member removal identity precondition', () => {
  it('keeps legacy omission distinct from mandatory browser identity', () => {
    expect(memberRemovalQuerySchema.parse({})).toEqual({})
    expect(memberRemovalCommandSchema.safeParse({}).success).toBe(false)
    expect(memberRemovalCommandSchema.parse({ expectedMemberId: 'member-a' })).toEqual({
      expectedMemberId: 'member-a',
    })
  })
  it.each([
    { expectedMemberId: '' },
    { expectedMemberId: 'a/b' },
    { expectedMemberId: ['a', 'b'] },
    { unknown: 'a' },
  ])('rejects %j without dropping the fence', (input) => {
    expect(memberRemovalQuerySchema.safeParse(input).success).toBe(false)
  })
  it('requires an explicit acknowledged success', () => {
    expect(memberRemovalResultSchema.parse({ removed: true })).toEqual({ removed: true })
    for (const input of [undefined, {}, { removed: false }])
      expect(memberRemovalResultSchema.safeParse(input).success).toBe(false)
  })
})
