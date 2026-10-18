import { describe, expect, it } from 'vitest'

import { apiKeyRevocationReasonSchema } from './admin-api-keys'
import {
  memberKeyCommandSchema,
  memberKeyQuerySchema,
  memberKeyResultSchema,
} from './member-api-keys'

describe('member credential boundaries', () => {
  it('requires the captured membership and rejects client-supplied selection for all', () => {
    expect(memberKeyCommandSchema.safeParse({}).success).toBe(false)
    expect(
      memberKeyCommandSchema.safeParse({ expectedMemberId: 'member-1', ids: ['key-1'] }).success
    ).toBe(false)
    expect(memberKeyCommandSchema.safeParse({ expectedMemberId: '../other' }).success).toBe(false)
  })
  it('bounds pagination and rejects duplicate or unknown query fields', () => {
    expect(memberKeyQuerySchema.parse({ expectedMemberId: 'member-1' })).toMatchObject({
      page: 1,
      limit: 20,
      status: 'all',
    })
    for (const q of [
      { page: 10001 },
      { limit: 101 },
      { page: ['1', '2'] },
      { status: 'active' },
      { search: 'x' },
    ])
      expect(memberKeyQuerySchema.safeParse({ expectedMemberId: 'member-1', ...q }).success).toBe(
        false
      )
  })
  it('accepts empty all and 1000, refuses partial or impossible acknowledgments', () => {
    const base = { organizationId: 'org-1', userId: 'user-1', memberId: 'member-1' }
    for (const n of [0, 1000])
      expect(
        memberKeyResultSchema.safeParse({ ...base, requestedCount: n, affectedCount: n }).success
      ).toBe(true)
    for (const [requestedCount, affectedCount] of [
      [1001, 1000],
      [0, 1],
      [-1, 0],
    ])
      expect(
        memberKeyResultSchema.safeParse({ ...base, requestedCount, affectedCount }).success
      ).toBe(false)
  })
  it('distinguishes all four permanent revocation actors without a cutover reason', () => {
    for (const reason of [
      'owner_revoked',
      'platform_revoked',
      'organization_admin_revoked',
      'membership_removed',
    ])
      expect(apiKeyRevocationReasonSchema.safeParse(reason).success).toBe(true)
    expect(apiKeyRevocationReasonSchema.safeParse('membership_absent').success).toBe(false)
  })
})
