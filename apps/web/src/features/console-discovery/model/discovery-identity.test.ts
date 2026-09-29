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

it('distinguishes filter-only changes and canonicalizes filter insertion order', () => {
  const base = { sortBy: 'name', effectiveSortOrder: 'asc' as const, page: 1 }
  const first = buildDiscoveryIdentity('/admin/api-keys', {
    ...base,
    extraQuery: { userId: 'owner', status: 'all', limit: '20' },
  })
  expect(
    buildDiscoveryIdentity('/admin/api-keys', {
      ...base,
      extraQuery: { limit: '20', status: 'all', userId: 'owner' },
    })
  ).toBe(first)
  expect(
    buildDiscoveryIdentity('/admin/api-keys', {
      ...base,
      extraQuery: { userId: 'owner', status: 'revoked', limit: '20' },
    })
  ).not.toBe(first)
})
