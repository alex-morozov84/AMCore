import { describe, expect, it } from 'vitest'

import { buildDiscoveryIdentity } from './discovery-identity'

describe('buildDiscoveryIdentity', () => {
  it('distinguishes page, sort, effective order, and search as one canonical view', () => {
    const base = '/en/admin/users'
    const first = buildDiscoveryIdentity(base, {
      search: 'alice',
      sortBy: 'name',
      effectiveSortOrder: 'asc',
      page: 1,
    })
    expect(first).toBe('/en/admin/users?search=alice&sortBy=name&sortOrder=asc')
    expect(
      buildDiscoveryIdentity(base, {
        search: 'alice',
        sortBy: 'name',
        effectiveSortOrder: 'asc',
        page: 2,
      })
    ).not.toBe(first)
    expect(
      buildDiscoveryIdentity(base, {
        search: 'alice',
        sortBy: 'name',
        effectiveSortOrder: 'desc',
        page: 1,
      })
    ).not.toBe(first)
  })
})
