import { describe, expect, it } from 'vitest'

import {
  adminDetailIdSchema,
  adminOrganizationDetailQuerySchema,
  adminUserDetailQuerySchema,
} from './admin-detail'

describe('admin detail queries', () => {
  it('accepts bounded pages and trims member search', () => {
    expect(
      adminOrganizationDetailQuerySchema.parse({ page: '2', limit: '25', search: '  Ada  ' })
    ).toEqual({
      page: 2,
      limit: 25,
      search: 'Ada',
    })
    expect(adminUserDetailQuerySchema.parse({ search: '  Northstar  ' }).search).toBe('Northstar')
  })

  it('rejects repeated, oversized and unsafe paging input', () => {
    for (const query of [
      { page: ['1', '2'] },
      { limit: ['10'] },
      { page: '1000001' },
      { page: '0' },
      { limit: '1000000' },
      { search: 'x'.repeat(256) },
    ]) {
      expect(adminOrganizationDetailQuerySchema.safeParse(query).success).toBe(false)
    }
    expect(adminUserDetailQuerySchema.safeParse({ page: ['1'] }).success).toBe(false)
    expect(adminUserDetailQuerySchema.safeParse({ search: 'x'.repeat(256) }).success).toBe(false)
  })

  it('accepts generated CUIDs and imported UUIDs but rejects malformed IDs', () => {
    expect(adminDetailIdSchema.safeParse('not-an-id').success).toBe(false)
    expect(adminDetailIdSchema.safeParse('clz1234560000abcdefghijk').success).toBe(true)
    expect(adminDetailIdSchema.safeParse('757a9fb4-34cf-40f4-a807-0f0cdbb9728b').success).toBe(true)
  })
})
